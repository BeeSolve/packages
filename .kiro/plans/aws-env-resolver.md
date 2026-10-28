# @beesolve/aws-env-resolver

## Status: Complete

## Problem Statement

Local development commonly loads its environment from committed `.env.*` files. That has two
recurring problems:

1. **Secrets end up committed in plaintext** — API keys, HMAC secrets, third-party config get
   pushed to git.
2. **Resource names/ARNs are hand-copied** — DynamoDB table names, S3 buckets, SQS queue URLs,
   and Lambda ARNs carry random CloudFormation suffixes and must be manually pasted in; they
   drift the moment a stack is recreated.

Both are mechanically avoidable. Everything in such a file is derivable from AWS plus a little
static config:

- **Non-secret resource identifiers** → one CloudFormation `DescribeStackResources` call, matched
  by logical-id prefix.
- **Secrets** → one Secrets Manager `GetSecretValue` on a named secret.
- **Static values** (region, profile, fixed URLs, constant index names) → from a config object
  the consuming project supplies.

`@beesolve/aws-env-resolver` is a **reusable, project-agnostic CLI + library** that resolves the
full environment from those sources, caches it (non-secrets on disk in the OS temp dir; secrets
in the **macOS keychain** when available), injects everything into `process.env`, and **spawns a
command as a child process** that inherits it. No secret ever lands in the project tree.

Intended consumer invocation — the resolver wraps whatever the real command was:

```jsonc
// before
"dev": "bun --hot dev.tsx"
// after
"dev": "aws-env-resolver -- bun --hot dev.tsx"
```

`aws-env-resolver` resolves → sets env → `exec`s the child with that env. The wrapped command is
unchanged; the child's import-time env validation just works.

### Package name

Primary: **`@beesolve/aws-env-resolver`** (directory `packages/aws-env-resolver`). Alternatives
considered and rejected as less descriptive: `@beesolve/dev-env`, `@beesolve/env-from-aws`,
`@beesolve/local-env`. Confirm the name before Task 1 — it is baked into the npm scope, the bunup
entry, and the CLI `bin`.

## Scope & Non-Goals

**In scope:** the standalone package (library API + `aws-env-resolver` CLI), a macOS keychain
secret cache with a non-macOS no-cache fallback, an OS-temp-dir cache for non-secrets with TTL +
purge, docs, tests, placeholder publish.

**Non-goals:** Linux/Windows secret backends (documented as unsupported → non-macOS falls back to
fetch-every-time, no secure cache); rotating/writing secrets back to AWS; any infra change. AWS
calls are read-only (`cloudformation:DescribeStackResources`, `secretsmanager:GetSecretValue`,
and optionally `sts:GetCallerIdentity` for ARN construction).

### No "stage" concept in the package

The package is **fully generic** and has **no notion of stages** (`dev`/`stg`/`prod` or
otherwise). Projects differ in how they select which environment to resolve, so the package
accepts an **opaque namespace string** (`--namespace` / `ResolveEnvOptions.namespace`) the user
supplies. It does two jobs: it is passed to the config factory so the project can pick which
stack/secret/profile to resolve, and it namespaces the on-disk cache and the keychain service so
parallel environments don't collide. The package itself never parses, enumerates, or branches on
its value. Example namespaces a project might use: `"staging"`, `"prod-readonly"`, `"acme-dev"`.

`--namespace` is **required** — there is no silent default. A project whose config is a
`(namespace) => options` factory would otherwise resolve the wrong environment (or cache under a
meaningless key) if the flag were forgotten; failing fast with "pass --namespace" is safer than a
surprising default.

## Architecture / Approach

### How it behaves at runtime (steady state)

On each wrapped boot, after the first run:

- Read non-secret resolved values from the **OS temp-dir cache** (`os.tmpdir()`), keyed by
  `projectKey` + `namespace` + a **short fingerprint** hashed from `{ region, stackName, secretId }`,
  honoring a TTL.
- Read secrets from the **macOS keychain** (`/usr/bin/security find-generic-password`), one item
  per secret key, under a service string that includes **the same fingerprint** as the cache.
- Merge static config + cached non-secrets + keychain secrets into one `Record<string,string>`,
  set onto `process.env`, and spawn the child command.

So steady state = **zero AWS calls** (one keychain read + one temp-file read). AWS is hit only on
first run, cache TTL expiry, a cache miss, or an explicit `--refresh` / `--purge`.

### Identity: cache + keychain keying, and two checkouts of the same repo

Both the cache file and the keychain service are keyed on the **same identity** so they split and
merge together:

```
identity   = { projectKey, namespace, fingerprint }
fingerprint = shortHash({ region, stackName, secretId })
cache file = os.tmpdir()/aws-env-resolver/<projectKey>-<namespace>-<fingerprint>.json
keychain   = service "aws-env-resolver:<projectKey>:<namespace>:<fingerprint>"
```

Neither identity includes the working directory / checkout path — **by design**. `projectKey`
comes from the committed `aws-env.config.ts`, not from `cwd`.

Consequences for **the same codebase checked out in two places**:

- **Same `namespace`, same stack/region/secret** (the normal case): both checkouts share one cache
  file and one set of keychain items. This is **correct and intended** — the resolved values are
  identical, so sharing avoids a redundant AWS fetch and a duplicate keychain prompt. Nothing is
  "overwritten" in a harmful sense; the written values are the same.
- **Same `namespace` but one checkout edited its config to point at a different stack/account**:
  the `fingerprint` differs, so **both** the cache file and the keychain service differ. The two
  checkouts get **separate** entries and do not clobber each other. (This is why the fingerprint
  must be in the keychain service, not just the cache key — otherwise the second checkout would
  overwrite the first checkout's secret under a service name that no longer matched its stack.)
- **Deliberately isolated caches for the same stack** (rare): use a distinct `--namespace` value
  per checkout. That is the explicit, opt-in way to separate them; the package never guesses this
  from the directory.

### macOS keychain policy (the security model, stated honestly)

- **macOS only.** On macOS, secrets are cached in the login keychain via the `security` CLI,
  encrypted at rest under the user's login password. On any non-macOS platform there is **no
  secure cache**: secrets are fetched fresh from Secrets Manager on every run and held only in the
  child process env (never written to disk). This limitation is documented prominently in
  `DOCS.md` and the getting-started guide.
- **Interactive mode by default** (`-T ''`, an empty trust list). With an empty `-T` list, every
  access prompts the user to allow the `security` binary to read the item — so the script never
  handles the user's password, macOS does. This is the default: more secure, prompt-on-each-access,
  no password handling in our code.
- **`--trusted` is an independent opt-in flag.** When passed, items are stored with
  `-T /usr/bin/security` so the `security` binary is pre-trusted and reads are silent. It is a
  plain on/off flag the user adds or omits. The package does **not** couple it to any stage,
  environment, or "production" notion — there is no automatic refusal; the user decides.
- Never log secret values. Keychain item account = the secret env-var name; service =
  `aws-env-resolver:<projectKey>:<namespace>:<fingerprint>` (fingerprint =
  `shortHash({ region, stackName, secretId })`, the same fingerprint the cache file uses) so items
  are namespaced per project+namespace+target and listed predictably for `--purge`.

The security win vs. a committed/plaintext `.env.*.local`: no plaintext at rest, not a predictable
dotfile path, OS-mediated access, optional per-access prompts. The honest limit (documented, not
hidden): malware already running as the user can shell out to `security` the same way we do unless
interactive mode (the default) forces a prompt — which is exactly why interactive is the default.

### Module layout (barrel exports allowed in this repo)

```
packages/aws-env-resolver/
  index.ts            # library public API ( "." export ) — resolveEnv(), types
  cli.ts              # "aws-env-resolver" bin: parse args, resolve, spawn child, proxy exit
  cdk.ts              # "./cdk" export — allowEnvResolution() emitter (introspects the CDK app)
  src/
    resolveConfig.ts  # CloudFormation DescribeStackResources + logical-id-prefix mapping
    secrets.ts        # Secrets Manager GetSecretValue -> parsed JSON record
    secretStore.ts    # SecretStore interface + KeychainSecretStore (macOS) + NoopSecretStore
    keychain.ts       # thin wrapper over /usr/bin/security (add/find/delete), platform guard
    cache.ts          # os.tmpdir() JSON cache: read/write/purge, TTL, key hashing
    spawn.ts          # spawn child with merged env (Bun.spawn), inherit stdio, proxy exit code
    emit.ts           # pure: CDK construct-tree -> EmittedConfig; generate/persist helpers
    types.ts          # ResolveEnvOptions, ResolverConfig, ResourceMapping, SecretMapping, EmittedConfig
  package.json
  tsconfig.json
  DOCS.md
  docs/adr-001-motivation.md
  docs/adr-002-cdk-config-emission.md
  docs/adr-003-bun-runtime-dependency.md
  docs/how-to/getting-started.md
  docs/how-to/define-a-project-config.md
  docs/how-to/emit-config-from-cdk.md
  tests/*.test.ts
```

### Library public API (`index.ts`)

The consumer-supplied, project-specific configuration is the whole point of reuse: the AWS
coordinates, the stack name, the logical-id → env-var mapping, and the static values are all
**parameters**, not hardcoded. None of them carry a stage meaning to the package.

```ts
/** Fully-resolved configuration for one resolution run. Supplied by the consuming project. */
export interface ResolverConfig {
  /** AWS profile for fromIni(); omit to use the default provider chain. */
  readonly profile?: string;
  readonly region: string;
  /** CloudFormation stack to read resources from. */
  readonly stackName: string;
  /** Secrets Manager id to read secrets from; omit if the project has no secrets. */
  readonly secretId?: string;
  /** Optional account id for ARN construction; resolved via STS on demand if omitted. */
  readonly accountId?: string;
  /** Env vars that need no AWS lookup (fixed URLs, constant index names, region, ...). */
  readonly staticEnv: Record<string, string>;
}

/** One target env var resolved from a CloudFormation stack resource. */
export interface ResourceMapping {
  readonly envVar: string; // e.g. "DATA_TABLE_NAME"
  readonly logicalIdPrefix: string; // e.g. "Data", "ExportsBucket"
  readonly resourceType?: string; // optional filter, e.g. "AWS::DynamoDB::Table"
  /** Transform the physical id into the final value (e.g. a Lambda name -> an ARN). */
  readonly transform?: (
    physicalId: string,
    ctx: { readonly region: string; readonly accountId: string },
  ) => string;
}

/** Secrets Manager JSON key -> target env var. */
export interface SecretMapping {
  readonly envVar: string; // e.g. "API_KEY"
  readonly jsonKey?: string; // key inside the secret JSON; defaults to envVar
}

export interface ResolveEnvOptions {
  readonly config: ResolverConfig;
  readonly resources: ReadonlyArray<ResourceMapping>;
  readonly secrets?: ReadonlyArray<SecretMapping>;
  /** Human-readable cache/keychain namespace, e.g. the project name. From the committed config. */
  readonly projectKey: string;
  /**
   * Opaque namespace. Passed to the config factory (so the project can pick a stack/secret) and
   * used, together with a fingerprint of { region, stackName, secretId }, to key the cache file
   * and keychain service. Never interpreted/enumerated by the package. Required — no default.
   */
  readonly namespace: string;
  readonly refresh?: boolean; // bypass caches, re-fetch from AWS, rewrite caches
  readonly cacheTtlMs?: number; // non-secret temp-dir cache TTL; default 24h
  readonly trusted?: boolean; // keychain silent mode; independent opt-in, no stage coupling
}

/** Resolve the full env (static + resources + secrets) as a flat record. Does not mutate process.env. */
export function resolveEnv(options: ResolveEnvOptions): Promise<Record<string, string>>;

export function purgeCache(options: {
  readonly projectKey: string;
  readonly namespace: string;
  readonly config: Pick<ResolverConfig, "region" | "stackName" | "secretId">;
}): Promise<void>;
```

Dashboards and other callers can use `resolveEnv(...)` directly to get a record; the CLI is a thin
wrapper that calls `resolveEnv`, assigns to `process.env`, and spawns the child.

`purgeCache` takes the fingerprint inputs (`region`/`stackName`/`secretId`) because the keychain
service string embeds that fingerprint — purging must target the exact same identity that was
written.

### CLI (`cli.ts`, published as `bin: "aws-env-resolver"`)

```
aws-env-resolver --namespace <ns> [--config <path>] [--profile <p>] [--refresh] [--purge] [--trusted] -- <command...>
```

- **`--namespace`** (**required**) the opaque label passed to the config factory and used to key
  the cache/keychain. No default — the CLI errors if it is missing.
- **`--config`** points at the consumer's config module (default lookup
  `aws-env.config.{ts,js,mjs}` in cwd). The module `export default`s either a `ResolveEnvOptions`
  object (minus the per-run flags) or a factory `(namespace: string) => Omit<ResolveEnvOptions,
  "namespace" | "refresh" | "trusted">`. This keeps all project-specific knowledge in the consumer
  repo and the package fully generic. **See "What is `aws-env.config.ts`?" below.**
- **`--profile`** overrides the AWS profile from the config.
- **`--purge`** → `purgeCache` + delete this project+namespace+fingerprint's keychain items, then
  exit (spawn a child only if a `-- command` is also given).
- **`--refresh`** → force AWS re-fetch, rewrite caches, continue to spawn.
- **`--trusted`** → silent keychain writes (`-T /usr/bin/security`). Independent on/off; no stage
  logic, no refusal.
- Everything after `--` is the child command. Spawn via `Bun.spawn` with
  `env: { ...process.env, ...resolved }`, `stdio: "inherit"`, exit with the child's code, and
  forward `SIGINT`/`SIGTERM`.

### What is `aws-env.config.ts`? (the generic/project bridge)

The package knows **how** to resolve env (call CloudFormation, read Secrets Manager, cache, spawn)
but cannot know **what** a given project needs — that is project-specific and lives in the consumer
repo. `aws-env.config.ts` is a small file the **consuming project writes and commits** that
exports the mapping: the stack name, which resources map to which env vars, which secret and JSON
keys map to which env vars, and the static values. The CLI loads it at startup. Without it, the
package would have to hardcode project knowledge, defeating reuse. It contains **no secret values**
— only names, mappings, and non-sensitive static config — so it is safe to commit.

Generic example (illustrative only — not tied to any real project):

```ts
// aws-env.config.ts
import type { ResolveEnvOptions } from "@beesolve/aws-env-resolver";

export default (
  namespace: string,
): Omit<ResolveEnvOptions, "namespace" | "refresh" | "trusted"> => ({
  projectKey: "example-app",
  config: {
    profile: "example-profile",
    region: "eu-central-1",
    stackName: "example-stack",
    secretId: "example/secrets",
    staticEnv: {
      BASE_URI: "https://example.test:3000",
      SOME_INDEX_NAME: "someGsi",
    },
  },
  resources: [
    { envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data", resourceType: "AWS::DynamoDB::Table" },
    { envVar: "EXPORT_BUCKET", logicalIdPrefix: "Exports", resourceType: "AWS::S3::Bucket" },
    {
      envVar: "SDK_HANDLER_ARN",
      logicalIdPrefix: "SdkHandler",
      resourceType: "AWS::Lambda::Function",
      transform: (name, { region, accountId }) =>
        `arn:aws:lambda:${region}:${accountId}:function:${name}`,
    },
  ],
  secrets: [{ envVar: "API_KEY" }, { envVar: "HMAC_SECRET" }],
});
```

### AWS credential pattern

`credentials: profile ? fromIni({ profile }) : undefined` (`@aws-sdk/credential-providers`), region
from `ResolverConfig.region`. `accountId` for ARN transforms comes from `ResolverConfig.accountId`
when present, otherwise lazily from `sts:GetCallerIdentity` (only when a `transform` actually needs
it).

### CDK config emission (`./cdk` export) — manual _or_ automated

The mapping in `aws-env.config.ts` can be written by hand (fully supported, the default) **or**
generated from the CDK app, which already knows — at synth time — every resource's logical id,
every lambda's `environment` block, the stack name, the region, and the secret ids. This keeps the
resolver config in sync with the real infra automatically: the same `environment: { DATA_TABLE_NAME:
dataTable.tableName }` that configures the deployed lambda is the source the emitter reads.

**What synth knows vs. doesn't (the honest boundary):** at synth time a resource's physical name
(e.g. `stg-BewatrApi-Data666C94C7-3TLI1OAEKFAP`) is an **unresolved CloudFormation token**, not a
string — CloudFormation assigns the random suffix at _deploy_ time. So the emitter can **never**
produce resolved physical values; it produces the **mapping/recipe** (env var → logical-id prefix +
stack + region + secret ids + static values), which the normal resolver then resolves against the
**deployed** stack at dev time. The two halves cannot drift because the mapping is derived from the
actual CDK wiring. (This is also why a "return real table names during synth" helper is impossible
and deliberately not offered.)

**How it introspects (direct walk, not an Aspect):** `allowEnvResolution` walks the given scope
(`scope.node.findAll()`), filters to lambda functions (`aws-lambda.Function` / `CfnFunction`), and
for each reads its `environment` entries. For each `{ key, value }`:

- `Token.isUnresolved(value) === false` → a **literal** → goes to `staticEnv[key]`.
- `Token.isUnresolved(value) === true` → resolve the token via `Stack.of(fn).resolve(value)` to its
  CloudFormation intrinsic (`{ Ref: "Data666C94C7" }` or `{ "Fn::GetAtt": ["Data666C94C7", "Arn"] }`),
  extract the **logical id**, strip CDK's 8-hex-char hash suffix to the stable **prefix** (`Data`),
  and record a `ResourceMapping { envVar: key, logicalIdPrefix }`. A `Fn::GetAtt` on an `Arn`
  attribute is recorded with the ARN `transform`; a plain `Ref` is recorded as the physical name.

An **Aspect** was considered and rejected: aspects run inside the synth prepare phase and are not
meant to perform file I/O, so wiring their output to a deterministic file write fights the CDK
lifecycle. A plain explicit walk invoked by the user in `app.ts` is simpler, synchronous, and
writes the file exactly when called. (Recorded in ADR-002.)

**Secrets** cannot be reliably discovered by walking (secret _values_ are injected as tokens that
look like any other env token, and the secret id lives on a `Secret.fromSecretNameV2` construct, not
on the lambda). So the caller passes the secret id(s) and which env vars come from them explicitly
— a small, non-sensitive argument. The emitter records `SecretMapping[]` from that.

**Three helpers (`generate` / `persist` / `generateAndPersist`), caller picks:**

```ts
import type { App, Stack } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

export interface AllowEnvResolutionProps {
  readonly projectName: string; // becomes projectKey in the emitted config
  /** Opaque namespace label for this synth (e.g. the stage string the app already has). */
  readonly namespace: string;
  /** Scope to introspect — usually the App or a Stage; defaults to the construct's root app. */
  readonly scope: IConstruct;
  /** AWS profile to bake into the emitted config (optional; dev can override via --profile). */
  readonly profile?: string;
  /** Secret id + the env vars sourced from it; the walk can't infer these safely. */
  readonly secrets?: ReadonlyArray<{
    readonly secretId: string;
    readonly envVars: ReadonlyArray<string>;
  }>;
  /** Extra static env the walk won't see (e.g. a dev-only BASE_URI override). */
  readonly staticEnv?: Record<string, string>;
}

/** Pure: introspect the scope, return the mapping. No I/O. */
export function generate(props: AllowEnvResolutionProps): EmittedConfig;

/** Write an EmittedConfig to disk (JSON by default). No CDK needed. */
export function persist(config: EmittedConfig, options: { readonly path: string }): void;

/** generate + persist in one call — the "as automated as possible" path. */
export function generateAndPersist(
  props: AllowEnvResolutionProps & { readonly path: string },
): EmittedConfig;
```

`persist(generate(...))` is exactly `generateAndPersist(...)` — the compound helper is just the
convenience the user asked for. `generate` returns a value for callers who want to inspect/merge it
or emit it their own way.

**`.json`, not `.ts`, for generated output.** Generated config is data, so it serializes to
`aws-env.config.json` — no code to lint/format, trivially diffable, safe to regenerate on every
synth. The CLI's config loader (Task 6) already accepts `aws-env.config.{ts,js,mjs}`; extend it to
also accept `aws-env.config.json`. **Hand-authored** config stays `.ts` (full type-checking, can use
`transform` functions and computed values). Rule of thumb documented in the how-to: _generated →
`.json`; manual → `.ts`_. A `transform` (a function) can't live in JSON, so for the ARN case the
emitter records a small declarative tag (e.g. `{ kind: "lambdaArn" }`) that the resolver interprets,
rather than an inline function — keeping `.json` fully declarative.

`EmittedConfig` is a JSON-serializable superset of the hand-written `ResolveEnvOptions` shape
(`projectKey`, `namespace`-agnostic config, `resources`, `secrets`, `staticEnv`), with declarative
transform tags instead of functions. The resolver accepts both the function form (`.ts`) and the
tagged form (`.json`).

**Intended use in `app.ts`:**

```ts
import { generateAndPersist } from "@beesolve/aws-env-resolver/cdk";

const app = new App();
const stage = new Stage(app, stageName);
// ... construct the stacks as today ...

if (process.env.EMIT_ENV_CONFIG) {
  generateAndPersist({
    projectName: "my-project",
    namespace: stageName,
    scope: stage,
    profile: config.profile,
    secrets: [{ secretId: `${stageName}/secrets`, envVars: ["HMAC_SECRET", "MOLLIE_API_KEY"] }],
    staticEnv: { BASE_URI: "https://local.test:3000" },
    path: "aws-env.config.json",
  });
}
```

Guarded by an env flag so it only emits when asked (e.g. `EMIT_ENV_CONFIG=1 bun cdk synth`), never on
every deploy. Documented pattern, not enforced by the package.

### Caching details (`cache.ts`)

- Fingerprint: `fingerprint = shortHash({ region, stackName, secretId })` — the single identity
  component shared by the cache file name and the keychain service string.
- Location: `path.join(os.tmpdir(), "aws-env-resolver", "<projectKey>-<namespace>-<fingerprint>.json")`.
- Contents: **only non-secret** resolved resource values + a `resolvedAt` timestamp + the full
  fingerprint inputs (`region`, `stackName`, `secretId`) for a defensive match check. Secrets are
  **never** written here.
- TTL: `cacheTtlMs` (default 24h). Expired or fingerprint-mismatched cache → treated as a miss.
- `--purge` removes the file (and the keychain items via `secretStore.purge`).

### secretStore (`secretStore.ts` + `keychain.ts`)

```ts
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(props: {
    readonly key: string;
    readonly value: string;
    readonly trusted: boolean;
  }): Promise<void>;
  purge(): Promise<void>;
}
```

- `KeychainSecretStore` (macOS only, `process.platform === "darwin"`): `get` → `security
  find-generic-password -a <key> -s <service> -w`; `set` → `security add-generic-password -a <key>
  -s <service> -w <value> -U` with `-T ''` (interactive, default) or `-T /usr/bin/security` (when
  `trusted`); `purge` → delete every item under the service. `service` =
  `aws-env-resolver:<projectKey>:<namespace>:<fingerprint>` (fingerprint =
  `shortHash({ region, stackName, secretId })`, identical to the cache file's fingerprint so cache
  and keychain always split/merge on the same identity — see "Identity" above).
- `NoopSecretStore` (non-macOS): `get` always returns `undefined` (forces a fresh AWS fetch each
  run), `set`/`purge` are no-ops. `resolveEnv` picks the store from `process.platform`.

### Cross-package dependencies

- Runtime deps (catalog): `@aws-sdk/client-cloudformation`, `@aws-sdk/client-secrets-manager`,
  `@aws-sdk/credential-providers`. (`client-cloudformation` and `credential-providers` already
  exist in the root catalog; **add `@aws-sdk/client-secrets-manager` to the root catalog**. If STS
  is used for `accountId`, add `@aws-sdk/client-sts` too.)
- `valibot` (catalog) for parsing the secret JSON and CLI args.
- **`aws-cdk-lib` + `constructs` as `peerDependencies` (catalog), mirrored into `devDependencies`**
  — used **only** by the `./cdk` entry point. The core `.` library and the `aws-env-resolver` CLI
  must **not** import `aws-cdk-lib` (keep the resolver dependency-light; a dev resolving env should
  not pull CDK). The emitter's pure core (`src/emit.ts`) takes already-extracted data so it can be
  unit-tested without CDK; only `cdk.ts` touches `aws-cdk-lib` types. Mirror `action-tokens` /
  `lambda-function-url-protection` for the peer+dev shape.
- Dev deps (catalog): `@types/bun`, `@types/node`; `typescript` optional peer (mirror
  `packages/hmac`).
- No `@beesolve/*` dependencies expected; still run `recalculate-dependencies` after scaffold.
- Keychain uses the OS `security` binary — **no dependency**. Child spawn uses `Bun.spawn` — no
  dependency.

### package.json exports + bin (mirror existing packages + add a bin)

```jsonc
{
  "name": "@beesolve/aws-env-resolver",
  "version": "0.0.0", // placeholder until first changeset release
  "type": "module",
  "files": ["dist", "docs/how-to", "DOCS.md"],
  "bin": { "aws-env-resolver": "./dist/cli.js" },
  "exports": {
    ".": { "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
    "./cdk": { "import": { "types": "./dist/cdk.d.ts", "default": "./dist/cdk.js" } },
    "./package.json": "./package.json",
  },
  "peerDependencies": {
    "aws-cdk-lib": "catalog:",
    "constructs": "catalog:",
    "typescript": "catalog:",
  },
  "peerDependenciesMeta": {
    "aws-cdk-lib": { "optional": true },
    "constructs": { "optional": true },
    "typescript": { "optional": true },
  },
}
```

`aws-cdk-lib`/`constructs` are **optional** peers — a consumer that only uses the CLI/resolver never
installs CDK; a consumer that uses `./cdk` already has CDK in its app. CLI shebang
`#!/usr/bin/env bun` at the top of `cli.ts` (the CLI relies on `Bun.spawn`). Document the Bun
requirement.

### bunup entry

```ts
{
  name: "@beesolve/aws-env-resolver",
  root: "packages/aws-env-resolver",
  config: {
    entry: ["index.ts", "cli.ts", "cdk.ts"],
    dts: { inferTypes: true, tsgo: true },   // valibot-derived types are exported
  },
},
```

### Key design decisions (to preserve in ADR-001)

- **CLI-wrapper model** (`aws-env-resolver -- <command>`) over writing a `.env.*.local` file:
  secrets reach the child only via inherited process env, never the project tree.
- **macOS keychain for secrets, OS-temp for non-secrets.** Keychain is macOS-only; non-macOS falls
  back to no secure cache (fetch-every-time). Stated as a macOS-only package in docs.
- **Interactive keychain (`-T ''`) is the default**; `--trusted` (`-T /usr/bin/security`) is an
  **independent opt-in flag** with no stage/production coupling and no automatic refusal.
- **No stage concept.** The package accepts an opaque, **required** `namespace` used only to pick
  the config (via the factory) and to namespace the cache/keychain; it never interprets or
  enumerates environment names.
- **Single shared identity for cache + keychain** — `{ projectKey, namespace, fingerprint }` where
  `fingerprint = shortHash({ region, stackName, secretId })` — keyed off the config, never the
  working directory, so two checkouts of the same repo pointed at the same stack share correctly
  and two pointed at different stacks never clobber each other.
- **Project config is injected** (`aws-env.config.ts`) so the package is reusable by any project —
  no project-specific knowledge in the package, and the config file carries no secrets.
- **Config can be hand-written (`.ts`) or CDK-emitted (`.json`).** The optional `./cdk` entry point
  introspects the construct tree (direct walk, not an Aspect) and emits the mapping — env var →
  logical-id prefix, stack, region, secret ids, static values — derived from the same `environment`
  blocks that configure the real lambdas, so config can't drift from infra. It emits the **recipe**,
  never resolved physical names (synth-time tokens are unresolved), which the resolver fills from the
  deployed stack. `generate` / `persist` / `generateAndPersist` let the caller pick purity vs.
  convenience. The core library and CLI never import `aws-cdk-lib` — it is an optional peer used only
  by `./cdk`.
- **Resources resolved from CloudFormation by logical-id prefix** (physical ids carry CFN hashes;
  logical-id prefixes are stable).
- **Read-only AWS**, using the standard `fromIni`/profile credential pattern.
- **Publish as 0.0.0 placeholder first** (OIDC Trusted Publisher before CI release), per the repo's
  `publish-placeholder-package` skill.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task in sequence. After each
task the user reviews the changes and signals "continue". No commits until the user approves; one
commit per task.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check`
3. `cd packages/aws-env-resolver && bun test` (per-package — never bare root `bun test`)

**Rules for subagents:**

- Each task is self-contained; no commits — leave changes uncommitted for review.
- Follow `.kiro/steering/` (TypeScript overrides: **no narrating comments** — only JSDoc on public
  API, non-obvious "why" rationale, or lint/type directives; barrel `index.ts` allowed in this
  repo; `== null` / `!= null` checks; descriptive array-callback variable names; `v.picklist` with
  `as const` for literal unions; oxfmt + oxlint).
- Use `catalog:` for shared external deps; run `bun install` after dep changes and
  `bun run recalculate-dependencies` after intra-repo dep changes.
- Build tool is bunup (`bun run build`).
- Read `packages/aws-env-resolver/package.json` `name` before creating any changeset.
- Start from `git pull --rebase origin main`; never `git push` without explicit user approval.

**Operational notes:**

- The macOS keychain backend uses the real `/usr/bin/security` binary. **Tests must not touch the
  real login keychain** — unit-test `KeychainSecretStore` against an injected command-runner stub
  (inject the `security`-invoking function), and test `NoopSecretStore` directly. Any opt-in
  integration test that hits the real keychain must create + delete its own uniquely-named service
  and be skipped by default / off CI.
- `/usr/bin/security` add/find/delete generic-password round-trips cleanly on macOS; the design
  relies only on that documented CLI surface.
- All examples in code and docs must be **generic and project-neutral** (e.g. `example-app`,
  `example-stack`, `example/secrets`). Do not reference any real deployment, account, stack, or
  secret name — this package is public.

**Progress tracking:** Mark tasks with `[x]` as completed.

## Tasks

### Task 1: Scaffold the package

- [x] Confirm the final package name with the user (default `aws-env-resolver`). Then run
      `bun run add-package aws-env-resolver`.
- [x] Edit the generated `package.json`: `"version": "0.0.0"`; add
      `"bin": { "aws-env-resolver": "./dist/cli.js" }`; set
      `"files": ["dist", "docs/how-to", "DOCS.md"]`; add the `.` + `./cdk` + `./package.json`
      exports; add `"test": "bun test"` and keep `"type-check": "tsc --noEmit"`; add runtime deps
      `@aws-sdk/client-cloudformation`, `@aws-sdk/client-secrets-manager`,
      `@aws-sdk/credential-providers`, `valibot` (all `catalog:`); add **optional** peers
      `aws-cdk-lib`, `constructs` (catalog) + mirror them into `devDependencies`; dev deps
      `@types/bun`, `@types/node` (`catalog:`); `typescript` optional peer. Mirror the peer+dev shape
      from `packages/action-tokens` / `packages/lambda-function-url-protection`; mirror
      `description`/`homepage`/`repository` from `packages/hmac`.
- [x] Add `@aws-sdk/client-secrets-manager` to the root `package.json` catalog (same version line
      as the other `@aws-sdk/*` entries). Add `@aws-sdk/client-sts` only if the account-id/STS path
      is implemented.
- [x] Update the scaffolded `bunup.config.ts` entry to
      `entry: ["index.ts", "cli.ts", "cdk.ts"], dts: { inferTypes: true, tsgo: true }`.
- [x] Replace the generated `tsconfig.json` `include` with `["src/**/*", "index.ts", "cli.ts", "cdk.ts", "tests/**/*"]`.
- [x] `bun install`, then `bun run recalculate-dependencies`.

**Files:** `packages/aws-env-resolver/{package.json,tsconfig.json,index.ts}`, `bunup.config.ts`, root `package.json`, `dependencies.json`

**Acceptance:** `bun run type-check` passes (empty `export {}` index compiles); bunup entry + bin present; catalog has `@aws-sdk/client-secrets-manager`.

---

### Task 2: Types + cache + temp-dir caching (with tests)

- [x] `src/types.ts`: `ResolverConfig`, `ResourceMapping`, `SecretMapping`, `ResolveEnvOptions`,
      and `EmittedConfig` (re-exported from `index.ts`) per the Architecture section. `ResourceMapping.transform`
      accepts **either** a function (`.ts` config) **or** a declarative tag
      (`{ kind: "lambdaArn" }` for `.json` config); define the tag union with `v.picklist`/`as const`.
      Use valibot only where parsing external input (secret JSON, CLI args, loaded `.json` config);
      plain interfaces for the hand-written config shapes. **No stage type or enum anywhere** —
      `namespace` is `string` and required.
- [x] `src/cache.ts`: `readCache` / `writeCache` / `purgeCache` over
      `os.tmpdir()/aws-env-resolver/<projectKey>-<namespace>-<fingerprint>.json` where
      `fingerprint = shortHash({ region, stackName, secretId })`; store only non-secret values +
      `resolvedAt` + the fingerprint inputs; TTL check (default 24h); never write secrets. Export a
      shared `computeFingerprint({ region, stackName, secretId })` helper so `cache.ts` and
      `secretStore.ts` derive the **same** fingerprint. Injectable enough to test without AWS.
- [x] Tests `tests/cache.test.ts`: write→read round-trip; TTL expiry → miss; fingerprint mismatch
      (different `stackName`) → miss and a **different file path**; `purgeCache` removes the file;
      assert no secret-shaped keys are ever persisted; assert `computeFingerprint` is stable for
      equal inputs and differs when `stackName`/`region`/`secretId` differ.

**Files:** `packages/aws-env-resolver/src/{types.ts,cache.ts}`, `index.ts`, `tests/cache.test.ts`

**Acceptance:** per-package `bun test` green; `bun run check` + `type-check` pass.

---

### Task 3: Keychain + SecretStore (with stubbed tests)

- [x] `src/keychain.ts`: thin wrapper over `/usr/bin/security` for `add`/`find`/`delete`
      generic-password, with the command-runner **injected** (default runner uses `Bun.spawn`) so
      tests never hit the real keychain. Interactive default (`-T ''`); `trusted` →
      `-T /usr/bin/security`. Platform guard: throw a clear error if called on non-darwin.
- [x] `src/secretStore.ts`: `SecretStore` interface; `KeychainSecretStore` (darwin) using
      `keychain.ts`; `NoopSecretStore` (non-darwin: `get` → undefined, `set`/`purge` no-ops). A
      `createSecretStore({ projectKey, namespace, config, platform })` factory returning the right
      one; it derives the service string `aws-env-resolver:<projectKey>:<namespace>:<fingerprint>`
      via the shared `computeFingerprint` from `cache.ts` (passing `config.region/stackName/secretId`),
      so cache and keychain share one identity. Account = secret env-var name.
- [x] Tests `tests/secretStore.test.ts`: with an injected fake runner, assert `set` builds the
      correct `security add-generic-password` argv for both interactive (`-T ''`) and trusted
      (`-T /usr/bin/security`); the service string includes the fingerprint and **differs when
      `stackName` differs** (the two-checkout-different-stack case); `get` parses the `-w` output;
      `purge` issues deletes; secret values never appear in anything the runner logs.
      `NoopSecretStore.get` returns undefined. Guard test: `KeychainSecretStore` on a simulated
      non-darwin platform throws.

**Files:** `packages/aws-env-resolver/src/{keychain.ts,secretStore.ts}`, `tests/secretStore.test.ts`

**Acceptance:** per-package `bun test` green (no real keychain access); `check` + `type-check` pass.

---

### Task 4: AWS resolution — CloudFormation resources + Secrets Manager (with tests)

- [x] `src/resolveConfig.ts`: given `ResolverConfig` + `ResourceMapping[]`, call
      `DescribeStackResources` (client built with `fromIni({ profile })` when `profile` set), match
      each mapping by `logicalIdPrefix` (+ optional `resourceType`), apply `transform` — if it is a
      function call it; if it is a declarative tag (`{ kind: "lambdaArn" }`) apply the built-in
      equivalent — passing `{ region, accountId }` (resolve `accountId` lazily via
      `GetCallerIdentity` only if a transform needs it, or from `ResolverConfig.accountId` if
      provided). Throw a precise error naming the `envVar` + `logicalIdPrefix` when no resource
      matches. Inject the CFN (and STS) client so tests stub them.
- [x] `src/secrets.ts`: given `secretId` + `SecretMapping[]`, call `GetSecretValue`, `v.parse` the
      JSON, map `jsonKey` (default `envVar`) → `envVar`. Throw naming the missing key. Inject the SM
      client.
- [x] Tests `tests/resolveConfig.test.ts` + `tests/secrets.test.ts` with stubbed `send`: happy path
      (prefix match → env record); missing resource throws a useful message; a `transform` (Lambda
      name → ARN) produces the expected ARN; secret JSON parsed and remapped; missing secret key
      throws. No real AWS calls.

**Files:** `packages/aws-env-resolver/src/{resolveConfig.ts,secrets.ts}`, `tests/{resolveConfig,secrets}.test.ts`

**Acceptance:** per-package `bun test` green; `check` + `type-check` pass.

---

### Task 5: `resolveEnv` orchestration + `spawn` + `index.ts` API

- [x] `src/spawn.ts`: spawn a child via `Bun.spawn(command, { env: { ...process.env, ...resolved },
      stdio: ["inherit","inherit","inherit"] })`, forward `SIGINT`/`SIGTERM`, resolve to the child's
      exit code.
- [x] `index.ts`: implement `resolveEnv(options)` — pick `SecretStore` by platform (built with the
      shared fingerprint); if `refresh` bypass caches; else read non-secrets from `cache.ts` (miss →
      `resolveConfig` → write cache) and each secret from the store (miss → `secrets.ts` fetch →
      `store.set` with `trusted`); merge `staticEnv` + resources + secrets into one record and
      **return it** (do not mutate `process.env` here). Export `purgeCache({ projectKey, namespace,
      config })` (temp file + `store.purge`, both via the shared fingerprint). Export all public
      types.
- [x] Tests `tests/resolveEnv.test.ts`: inject fake cache/store/AWS; assert (a) cache+keychain hit
      path makes zero AWS calls, (b) `refresh` forces AWS + rewrites both caches, (c) a fresh secret
      is written to the store with the correct `trusted` flag, (d) merged record precedence is
      static < resources < secrets (document and test the chosen precedence).

**Files:** `packages/aws-env-resolver/src/spawn.ts`, `index.ts`, `tests/resolveEnv.test.ts`

**Acceptance:** per-package `bun test` green; `bun run build` emits `dist/index.{js,d.ts}`; `check` + `type-check` pass.

---

### Task 6: CLI (`cli.ts`)

- [x] `cli.ts` with `#!/usr/bin/env bun`: parse `--namespace` (**required**), `--config` (default
      lookup `aws-env.config.{ts,js,mjs,json}` in cwd — **`.json` is the CDK-emitted form**, the
      others are hand-written), `--profile`, `--refresh`, `--purge`, `--trusted`, and the
      `-- <command...>` tail. For `.json`, parse + `v.parse` into `EmittedConfig` (tagged transforms);
      for `.ts`/`.js`/`.mjs`, import the `default` export. Validate args with valibot; error with
      clear usage when `--namespace` is missing.
- [x] Load the consumer config module's `default` export (object or `(namespace) => options`
      factory); build `ResolveEnvOptions`, applying `--namespace`, `--profile` override, `--refresh`,
      `--trusted`. **No stage logic; `--trusted` is accepted unconditionally.**
- [x] `--purge` → `purgeCache({ projectKey, namespace, config })` + delete keychain items, then
      exit 0 (spawn the command afterward only if one was supplied).
- [x] Otherwise: `const env = await resolveEnv(...)`; `Object.assign(process.env, env)`; spawn the
      `-- ` command via `spawn.ts`; `process.exit(code)`.
- [x] Tests `tests/cli.test.ts`: arg parsing — **missing `--namespace` errors**; `--` tail
      captured; config-factory invoked with the given `--namespace`; `--trusted` simply flows
      through to `resolveEnv` (no refusal). Mock `resolveEnv`/`spawn` so no AWS/keychain/child runs.

**Files:** `packages/aws-env-resolver/cli.ts`, `tests/cli.test.ts`

**Acceptance:** per-package `bun test` green; `bun run build` emits `dist/cli.js` with the shebang; `bun dist/cli.js --help` prints usage.

---

### Task 7: CDK config emitter (`./cdk` + `src/emit.ts`, with tests)

- [x] `src/emit.ts` (**pure, no `aws-cdk-lib` import**): accepts already-extracted data — an array of
      `{ envVar, value: string | { intrinsic: object } }` per lambda plus `projectName`, `namespace`,
      `profile`, `secrets`, `staticEnv` — and builds `EmittedConfig`. For each entry: a plain string →
      `staticEnv`; an intrinsic (`{ Ref }` / `{ "Fn::GetAtt" }`) → extract the logical id, strip the
      trailing CDK 8-hex-char hash to the stable `logicalIdPrefix`, and emit a `ResourceMapping`
      (with the `{ kind: "lambdaArn" }` tag when the intrinsic is a `Fn::GetAtt` on an `Arn`
      attribute). Merge `secrets` into `SecretMapping[]`, `staticEnv` passthrough. Dedupe env vars;
      throw on a conflicting duplicate.
- [x] `cdk.ts` (**the only file importing `aws-cdk-lib`**): `generate(props)` walks
      `props.scope.node.findAll()`, filters to lambda functions, reads each function's `environment`,
      and for each value uses `Token.isUnresolved(value)` to decide literal vs. token;
      resolves tokens via `Stack.of(fn).resolve(value)` to the CloudFormation intrinsic; hands the
      extracted `{ envVar, value | intrinsic }` list to `src/emit.ts`. `persist(config, { path })`
      writes JSON (default `.json`). `generateAndPersist(props & { path })` = `persist(generate(...))`.
      Export `AllowEnvResolutionProps`, `generate`, `persist`, `generateAndPersist`.
- [x] Tests: `tests/emit.test.ts` drives `src/emit.ts` directly with synthetic intrinsics (no CDK) —
      `{ Ref: "Data666C94C7" }` → prefix `Data`; `{ "Fn::GetAtt": ["SdkHandlerAB12CD34", "Arn"] }` →
      prefix `SdkHandler` + `lambdaArn` tag; literal → `staticEnv`; hash-strip edge cases (no suffix,
      multiple segments); duplicate-conflict throws; `secrets`/`staticEnv` passthrough. A small
      `tests/cdk.test.ts` builds a **real tiny CDK app** (an `App` + one `Stack` + one
      `lambda.Function` with an `environment` referencing a `Table.tableName` and a literal), runs
      `generate`, and asserts the mapping — plus `persist` writes valid JSON that round-trips through
      the CLI's `.json` loader. Keychain/AWS untouched.

**Files:** `packages/aws-env-resolver/{cdk.ts,src/emit.ts}`, `tests/{emit,cdk}.test.ts`

**Acceptance:** per-package `bun test` green; `bun run build` emits `dist/cdk.{js,d.ts}`; `src/emit.ts` has **no** `aws-cdk-lib` import (core stays CDK-free); `check` + `type-check` pass.

---

### Task 8: Documentation (DOCS.md, ADRs, how-to guides) + README row

- [x] `docs/adr-001-motivation.md` per `.kiro/steering/adrs.md` (Status Accepted; Context =
      secrets-in-git + hand-copied CFN resource names; Decision = reusable CLI/lib resolving env
      from CloudFormation + Secrets Manager with a macOS-keychain secret cache and child-process
      injection; Rationale numbered: CLI-wrapper vs dotfile, keychain-vs-plaintext with the honest
      limit, interactive-default with an independent `--trusted` opt-in, no stage concept, injected
      project config for reuse; Consequences incl. macOS-only secure cache; Alternatives =
      `.env.*.local`, SSM Parameter Store, 1Password CLI, AWS Vault). All examples generic.
      **ADR-003 (Bun runtime dependency) already exists** — the motivation ADR should cross-reference
      it for the runtime-choice rationale rather than re-arguing it; do not renumber it.
- [x] `docs/adr-002-cdk-config-emission.md` (Status Accepted; Context = hand-maintained mapping
      drifts from infra; Decision = optional `./cdk` emitter that derives the mapping from the
      construct tree; Rationale numbered: emit recipe-not-values because synth tokens are unresolved,
      direct walk over an Aspect (I/O in prepare phase), `.json` for generated vs `.ts` for manual,
      CDK as optional peer so the core stays light, declarative transform tags so `.json` is pure
      data; Consequences incl. third-party-construct env vars the walk can't see → manual merge;
      Alternatives = Aspect, CfnOutput-based resolution, resolve-at-synth (impossible)).
- [x] `DOCS.md` (add-package full template, has how-tos): title + one-liner; `**Keywords:**` line
      (`aws env, local development env, secrets manager, cloudformation, macos keychain,
      aws-env-resolver, dev server env, cdk config emit`); canonical-docs directive blockquote;
      GitHub link; **prominent macOS-only secure-cache note**; How-To table linking all three guides
      (getting-started, define-a-project-config, emit-config-from-cdk); "No dedicated sample exists
      yet; see the how-to guides." for Working Examples; Further Reading.
- [x] `docs/how-to/getting-started.md`: install; the script rewrite
      (`aws-env-resolver --namespace <ns> -- <your command>`); `--refresh` / `--purge` /
      `--namespace` (required) / `--trusted` behavior (describe `--trusted` as an independent opt-in
      that makes keychain reads silent, with the security tradeoff); a short **"same repo in two
      checkouts"** subsection explaining that cache/keychain are keyed on
      `projectKey`+`namespace`+a stack/region/secret fingerprint (not the directory), so identical
      stacks share and different stacks never clobber; the macOS-only caching caveat and the
      non-macOS fetch-every-time fallback. Samples < 30 lines, only real APIs, generic names.
- [x] `docs/how-to/define-a-project-config.md`: how to author `aws-env.config.ts` **by hand** —
      explain it is the generic/project bridge (what it is for, that it carries no secrets, that it
      is committed in the consumer repo), the object-or-factory shape returning `ResolverConfig` +
      `ResourceMapping[]` + `SecretMapping[]`, using the **generic** example from the Architecture
      section (`example-app` / `example-stack` / `example/secrets`), and the _generated → `.json`,
      manual → `.ts`_ rule of thumb. No real project names.
- [x] `docs/how-to/emit-config-from-cdk.md`: how to generate the config from CDK — import
      `generate` / `persist` / `generateAndPersist` from `@beesolve/aws-env-resolver/cdk`, the
      `app.ts` example guarded by an env flag, what it can and can't infer (own lambdas' `environment`
      auto; secrets + third-party-construct vars passed explicitly), and the synth-emits-recipe-not-
      values boundary. Generic names only.
- [x] Add a `@beesolve/aws-env-resolver` row to the Packages table in root `README.md`.
- [x] Add the `0.x` stability banner requirement to the package `README.md` (per
      `.kiro/steering/versioning.md`) if the scaffold creates a README; otherwise note it is added
      at first release.

**Files:** `packages/aws-env-resolver/{DOCS.md,docs/adr-001-motivation.md,docs/adr-002-cdk-config-emission.md,docs/how-to/getting-started.md,docs/how-to/define-a-project-config.md,docs/how-to/emit-config-from-cdk.md}`, root `README.md`

**Acceptance:** `DOCS.md` has the Keywords line + canonical-docs directive + macOS-only note; How-To table links all three guides; no dangling links; no real project/account/stack/secret names anywhere; `files` allowlist already includes `docs/how-to` + `DOCS.md`.

---

### Task 9: Placeholder publish + changeset + full verification

- [x] Follow `.kiro/skills/publish-placeholder-package/SKILL.md` to reserve the npm name and
      register the OIDC Trusted Publisher (publish a `0.0.0` placeholder, then
      `npm trust github @beesolve/aws-env-resolver --repo BeeSolve/packages --file publish.yml --yes`).
      **The subagent does NOT run the actual npm publish** — it prepares/verifies and surfaces the
      exact commands for the user to run, since publishing requires npm auth/OTP.
- [x] Read `packages/aws-env-resolver/package.json` to confirm the name, then `bunx changeset` →
      select `@beesolve/aws-env-resolver`, `minor`, summary: "Initial release: resolve local dev env
      from CloudFormation + Secrets Manager, cache non-secrets in the OS temp dir and secrets in the
      macOS keychain (interactive by default, optional `--trusted`), inject into a spawned command,
      and optionally emit the config from a CDK app via `./cdk`."
- [x] `bun run recalculate-dependencies`.
- [x] Full gates: `bun run check`, `bun run type-check`, `bun run build` (emits
      `dist/{index,cli,cdk}.{js,d.ts}`), and per-package `cd packages/aws-env-resolver && bun test`.

**Files:** `.changeset/*.md`, `dependencies.json`

**Acceptance:** all gates green; changeset ready (uncommitted); build emits index + cli + cdk artifacts; placeholder-publish commands surfaced to the user (not executed).

---

## Future Work (out of scope)

- **Consumer adoption:** in any project that wants dynamic local env, author an `aws-env.config.ts`
  (the `define-a-project-config` how-to is the template), rewrite the relevant scripts to
  `aws-env-resolver --namespace <ns> -- <existing command>`, and strip secrets + hand-copied
  resource names out of that project's committed env files (keeping only genuinely-static
  non-sensitive defaults, or deleting them). Ensure the chosen AWS profile has
  `cloudformation:DescribeStackResources` + `secretsmanager:GetSecretValue` (and
  `sts:GetCallerIdentity` if ARN transforms are used).
- **Linux secret backend** (`secret-tool` / libsecret) if a Linux dev needs a secure cache; today
  non-macOS falls back to fetch-every-time.
- Run the real placeholder npm publish + OIDC registration (manual, one-time).

## New Public API Surface

| Export                                        | Kind                | Notes                                                                                 |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `resolveEnv`                                  | function (`.`)      | Resolve full env record from static + CloudFormation + Secrets Manager                |
| `purgeCache`                                  | function (`.`)      | Remove temp-dir cache + keychain items for a project+namespace+fingerprint            |
| `ResolverConfig`                              | interface (`.`)     | Per-project AWS coordinates + static env (consumer-supplied)                          |
| `ResourceMapping`                             | interface (`.`)     | CloudFormation logical-id-prefix → env var (function or tagged transform)             |
| `SecretMapping`                               | interface (`.`)     | Secrets Manager JSON key → env var                                                    |
| `EmittedConfig`                               | interface (`.`)     | JSON-serializable config shape produced by the CDK emitter                            |
| `ResolveEnvOptions`                           | interface (`.`)     | Input to `resolveEnv` (includes required opaque `namespace`, `trusted`)               |
| `generate` / `persist` / `generateAndPersist` | functions (`./cdk`) | Emit the config by introspecting a CDK app (recipe, not resolved values)              |
| `AllowEnvResolutionProps`                     | interface (`./cdk`) | Input to the CDK emitter (`projectName`, `namespace`, `scope`, `secrets`, ...)        |
| `aws-env-resolver`                            | bin                 | CLI: `--namespace (required) --config --profile --refresh --purge --trusted -- <cmd>` |
