# @beesolve/aws-env-resolver

Resolve local development environment from CloudFormation and Secrets Manager, cache it, and inject it into a spawned command.

> [!WARNING]
> **Pre-1.0 - unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

> **macOS-only secure cache.** Secrets are cached in the macOS login keychain. On other platforms secrets are fetched on every run and never written to disk. The CLI requires Bun.

## Install

```sh
bun add -d @beesolve/aws-env-resolver
```

```sh
npm install --save-dev @beesolve/aws-env-resolver
```

## CLI

```sh
aws-env-resolver [--stage <stage>] [options] -- <command...>
```

Put flags before `--`. Bun drops a leading `--`, so with no flags the first non-flag argument starts the command.

| Flag               | Description                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| `--stage <stage>`  | Optional. Picks `aws-env.config.<stage>.*` first, passed to a factory, keys caches.  |
| `--target <name>`  | Target to resolve when the config defines several. Optional with exactly one target. |
| `--config <path>`  | Config module or JSON (default: `aws-env.config.{ts,js,mjs,json}` in the cwd).       |
| `--profile <name>` | AWS profile; overrides the config.                                                   |
| `--refresh`        | Bypass caches and re-fetch from AWS.                                                 |
| `--purge`          | Delete cached values for this stage (runs `<command>` only if given).                |
| `--trusted`        | Store keychain items so reads are silent (no prompt).                                |
| `--help`           | Show help.                                                                           |

Exit codes: `0` success, `1` runtime error, `2` invalid arguments. When a command runs, its exit code is returned.

## Library (`@beesolve/aws-env-resolver`)

| Export                | Description                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `resolveEnv`          | `(options: ResolveEnvOptions) => Promise<Record<string, string>>`. Does not mutate `process.env`.                     |
| `purgeCache`          | `({ projectKey, stage?, target?, config, secretKeys? }) => Promise<void>`. Deletes the cache file and keychain items. |
| `ResolveEnvOptions`   | `config`, `resources`, `secrets?`, `projectKey`, `stage?`, `target?`, `refresh?`, `cacheTtlMs?`, `trusted?`.          |
| `ResolverConfig`      | `profile?`, `region`, `stackName` (one name or a list), `secretId?`, `accountId?`, `staticEnv`.                       |
| `ResourceMapping`     | `envVar`, `logicalIdPrefix`, `resourceType?`, `stackName?`, `transform?`.                                             |
| `TemplateMapping`     | `envVar`, `parts`: literal strings and resource references (`logicalIdPrefix`, ...), concatenated.                    |
| `SecretMapping`       | `envVar`, `jsonKey?` (defaults to `envVar`).                                                                          |
| `ResourceTransform`   | A function `(physicalId, { region, accountId }) => string` or a `TransformTag`.                                       |
| `TransformTag`        | `{ kind: "lambdaArn" }`, for JSON config.                                                                             |
| `TransformContext`    | `{ region, accountId }`.                                                                                              |
| `EmittedConfig`       | JSON config shape produced by the CDK emitter: `projectKey` and `targets` (name to `EmittedTarget`).                  |
| `EmittedTarget`       | One target's `config`, `resources`, `secrets?`.                                                                       |
| `emittedConfigSchema` | Valibot schema for `EmittedConfig`.                                                                                   |
| `emittedTargetSchema` | Valibot schema for `EmittedTarget`.                                                                                   |
| `defaultTarget`       | `"default"`, the target used when none is named.                                                                      |

## CDK (`@beesolve/aws-env-resolver/cdk`)

Requires the optional peers `aws-cdk-lib` and `constructs`.

| Export                    | Description                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `traceEnv`                | `(construct, { target? }) => void`. Marks a Lambda, or a construct containing Lambdas, to emit.   |
| `generate`                | `(props: AllowEnvResolutionProps) => EmittedConfig`. Walks the scope; no I/O.                     |
| `persist`                 | `(config, { path }) => void`. Writes JSON, creating parent directories.                           |
| `generateAndPersist`      | `generate` then `persist`; optional `stage` and `path` (default `aws-env.config[.<stage>].json`). |
| `defaultConfigPath`       | `(stage?) => string`. The file name `generateAndPersist` writes without a `path`.                 |
| `AllowEnvResolutionProps` | `projectName`, `scope` (construct or array), `profile?`, `secrets?`, `staticEnv?`.                |
| `TraceEnvOptions`         | `target?`: a name or a list of names. Defaults to `"default"`.                                    |

Only constructs marked with `traceEnv` are emitted. `traceEnv(construct)` traces every Lambda function under the construct, so you can pass a function, an auth gateway, a site, or a stack. Nothing is passed through stacks. `traceEnv(app)` traces everything. `scope` only limits where `generate` looks for markers.

Each target is emitted and conflict-checked on its own, so one env var may point at different resources in different targets. A target's stacks must share one region. `secrets` and `staticEnv` apply to every target. `Ref` and `Fn::GetAtt` `Arn` are supported; other intrinsics throw. Env vars set from `secret.secretValueFromJson(key)` (a `{{resolve:secretsmanager:...}}` dynamic reference) are emitted as secret mappings automatically. The emitter writes a recipe (env var to logical-id prefix), never resolved physical names.

## Config

The CLI loads the first of `aws-env.config.<stage>.ts`, `.js`, `.mjs`, `.json` (with `--stage`), then `aws-env.config.ts`, `.js`, `.mjs`, `.json`, in the cwd. A module exports an options object or a `(stage) => options` factory (sync or async). A JSON file is the CDK-emitted form: `{ projectKey, targets }`. With one target `--target` is optional; with several it is required. A module factory receives `(stage, target)`. A flat JSON file without `targets` (the pre-targets shape) loads as the `default` target. Generated config goes to `.json`, hand-written config goes to `.ts`.

When an env var appears in several sources, the later one wins: `config.staticEnv`, then CloudFormation resources, then secrets.

## Caching

- Non-secret values: `os.tmpdir()/aws-env-resolver/<projectKey>-<stage>-<fingerprint>.json`, 24 hour TTL by default (`cacheTtlMs`).
- Secrets: macOS keychain, service `aws-env-resolver:<projectKey>:<stage>:<fingerprint>`, one item per secret env var. The fingerprint hashes `region`, `stackName`, and `secretId`, so the cache and keychain share one identity independent of the working directory. A non-default target also enters the cache file's fingerprint (not the keychain's), so targets sharing a stack keep separate resource caches.
- Default mode stores items with an empty trust list, so macOS may prompt once per secret on read. `--trusted` stores them with `-T /usr/bin/security` for silent reads.
- Steady state makes zero AWS calls.
- On non-macOS platforms there is no secure cache and secrets are fetched on every run.

## IAM permissions

- `cloudformation:ListStackResources`
- `secretsmanager:GetSecretValue`
- `sts:GetCallerIdentity`, only when an ARN transform runs without `config.accountId`

See [DOCS.md](./DOCS.md) for the how-to guides.
