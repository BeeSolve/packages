# @beesolve/lambda-function-url-protection

## Status: Not Started

## Problem Statement

`kit-on-lambda`'s default origin factory (`toFunctionUrlOrigin` in `cdk.ts`) exposes the
SvelteKit SSR Lambda through a **Lambda Function URL with `authType: NONE`**. To stop
direct invocation that bypasses CloudFront, it generates a 128-char Secrets Manager secret,
injects it into the Lambda as the `ORIGIN_TOKEN` env var, and makes CloudFront forward it to
the origin as the `x-origin-token` custom header.

The CDK half is wired, but **nothing verifies the token at runtime**. A grep of
`kit-on-lambda` confirms the four handlers (`files/{node,bun}/{handler,stream}.ts`) never read
`ORIGIN_TOKEN` or inspect `x-origin-token`. Because the Function URL is `NONE`, anyone who
discovers the URL can invoke the Lambda directly, fully bypassing CloudFront (and therefore
the basic-auth CloudFront function, caching, and any WAF). The injected secret is currently
decorative.

Every real deployment in the monorepo (`dmarc-dashboard`, `email-service-dashboard`) overrides
`toDefaultOrigin` to route through the auth-service API Gateway + Lambda authorizer, so they
are protected by IAM and never exercise the token path. The gap is specifically the adapter's
**out-of-the-box Function URL origin**, used when a consumer does not front the Lambda with an
API Gateway authorizer.

This package owns **both halves of the token contract** so they cannot drift:

- a runtime wrapper that enforces the token (fail-closed) — mirrors `@beesolve/lambda-keep-active`'s `./runtime` and composes with `@beesolve/lambda-fetch-api`;
- a CDK **helper** (not a Construct) that generates the secret, injects the env var, adds the Function URL, and returns a `FunctionUrlOrigin` carrying the header.

`kit-on-lambda` adoption is explicitly a **follow-up** — this plan only builds and publishes
the standalone package.

## Architecture / Approach

### Package layout

Mirrors `@beesolve/lambda-keep-active` (dual export: CDK + `./runtime`, with a `shared` module
for the contract constants).

```
packages/lambda-function-url-protection/
  index.ts          # CDK side — protectedFunctionUrlOrigin() helper ( "." export )
  runtime.ts        # runtime enforcement wrappers        ( "./runtime" export )
  shared.ts         # originTokenHeader / originTokenEnvVar constants
  package.json
  tsconfig.json
  DOCS.md
  docs/adr-001-motivation.md
  docs/how-to/getting-started.md
  tests/runtime.test.ts
```

Directory `packages/lambda-function-url-protection/` → package name
`@beesolve/lambda-function-url-protection` (directory == scope suffix here, unlike some others).

### Shared contract (`shared.ts`)

```ts
export const originTokenHeader = "x-origin-token";
export const originTokenEnvVar = "ORIGIN_TOKEN";
```

Both the runtime and the CDK helper import these so the header/env names can never diverge.

### Runtime API (`./runtime`)

Fail-closed is the **only** behavior. The handler only ever runs inside Lambda (local dev does
not invoke it), so there is no fail-open / "skip when empty" branch. If `ORIGIN_TOKEN` is
missing or empty in the environment, that is a deployment misconfiguration and every request is
rejected.

Two composable wrappers matching the two handler styles in `kit-on-lambda`:

```ts
type Fetch = (request: Request) => Promise<Response>;

/** Fetch-level guard. Compose inside asHttpV2Handler / asResponseStreamHandler. */
export function protectFetch(fetch: Fetch): Fetch;

/** Raw-event guard for (event, context) handlers. Layers with keptActive. */
export function protectHandler<Event, Context, Response>(
  handler: (event: Event, context: Context) => Promise<Response>,
): (event: Event, context: Context) => Promise<Response>;
```

Behavior:

- Read the expected token from `process.env[originTokenEnvVar]`.
- `protectFetch`: read presented token from `request.headers.get(originTokenHeader)`.
- `protectHandler`: read presented token from the event headers. API Gateway / Function URL
  event headers are case-insensitive in practice but delivered as a plain object, so look up
  both `x-origin-token` and any case variant via a small case-insensitive getter over
  `event.headers`.
- Compare with a **constant-time** comparison (see below).
- On match → delegate to the wrapped handler/fetch.
- On mismatch / missing / env unset → return **403**:
  - `protectFetch` returns `new Response(null, { status: 403, headers: { "cache-control": "no-store" } })`.
  - `protectHandler` returns the AWS proxy result shape `{ statusCode: 403, headers: { "cache-control": "no-store" }, body: "" }`.
- Never log the token value.

Constant-time compare helper (internal, not exported):

```ts
import { timingSafeEqual } from "node:crypto";

function tokensMatch(expected: string | undefined, presented: string | null): boolean {
  if (expected == null || expected.length === 0) return false; // fail-closed on misconfig
  if (presented == null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
```

`node:crypto.timingSafeEqual` is available on both Node 24 and Bun, so no extra dependency.

Intended composition in `kit-on-lambda` (documented, implemented in the follow-up):

```ts
// streaming
export const handler = asResponseStreamHandler(
  protectFetch(async (request) => server.respond(request, { ... })),
);

// node buffered (keptActive OUTSIDE so keep-active pings short-circuit before the token check)
export const handler = keptActive(protectHandler(async (event, context) => { ... }));
```

Keep-active ordering note belongs in the how-to guide: keep-active pings invoke the Lambda
directly and carry no token, so `keptActive` must wrap `protectHandler` (ping check runs first),
otherwise valid pings would be rejected 403.

### CDK API (`.`)

A plain **helper function**, not a `Construct`. It does not expose an option to change the
Function URL auth mode — the auth type is fixed to `NONE` by design; a consumer who wants a
different origin overrides `toDefaultOrigin` entirely rather than tweaking this helper.

```ts
import type { OriginBase } from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { Function } from "aws-cdk-lib/aws-lambda";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";

export interface ProtectedFunctionUrlOriginProps {
  readonly handler: Function;
  /** @default InvokeMode.RESPONSE_STREAM */
  readonly invokeMode?: InvokeMode;
  /** CORS allowed origins for the Function URL. @default ["*"] */
  readonly allowedOrigins?: Array<string>;
}

export function protectedFunctionUrlOrigin(props: ProtectedFunctionUrlOriginProps): OriginBase;
```

Implementation (lifted verbatim from `kit-on-lambda`'s `toFunctionUrlOrigin`, parameterized,
reading header/env names from `shared.ts`):

1. `const originToken = new Secret(handler, "OriginToken", { description, removalPolicy: DESTROY, generateSecretString: { passwordLength: 128, excludePunctuation: true } }).secretValue.toString();`
2. `handler.addEnvironment(originTokenEnvVar, originToken);`
3. `const url = handler.addFunctionUrl({ authType: FunctionUrlAuthType.NONE, invokeMode, cors: { allowedOrigins } });`
4. `return new FunctionUrlOrigin(url, { customHeaders: { [originTokenHeader]: originToken } });`

### Cross-package dependencies

- `.` (CDK) side: `aws-cdk-lib` + `constructs` as **peerDependencies** (catalog versions),
  mirrored into `devDependencies` for building — same shape as `action-tokens`.
- `./runtime` side: no runtime deps (`node:crypto`, `node:process`, Web `Request`/`Response`).
- `@types/aws-lambda` (catalog) as a dev dependency for the proxy event/result types in
  `protectHandler`.
- No `@beesolve/*` dependencies needed. (So `recalculate-dependencies` will add it with no
  intra-repo edges, but still run it.)

### package.json exports (mirror lambda-keep-active)

```jsonc
{
  "name": "@beesolve/lambda-function-url-protection",
  "version": "0.0.0", // placeholder until first real changeset release
  "type": "module",
  "files": ["dist", "docs/how-to", "DOCS.md"],
  "exports": {
    ".": { "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
    "./runtime": { "import": { "types": "./dist/runtime.d.ts", "default": "./dist/runtime.js" } },
    "./package.json": "./package.json",
  },
}
```

### bunup entry

```ts
{
  name: "@beesolve/lambda-function-url-protection",
  root: "packages/lambda-function-url-protection",
  config: { entry: ["index.ts", "runtime.ts"] },
},
```

(Matching `lambda-keep-active`: no `inferTypes` needed — types are simple.)

### Key design decisions

- **Fail-closed only.** No fail-open/skip-when-empty path; the handler runs only in Lambda, so
  a missing/empty `ORIGIN_TOKEN` is a misconfiguration and must reject. (User-confirmed.)
- **Keep the Secrets Manager secret** exactly as `kit-on-lambda` does today. (User-confirmed.)
- **Helper, not Construct**, and **no auth-mode option** — overriding the origin is the escape
  hatch. (User-confirmed.)
- **Constant-time comparison** via `node:crypto.timingSafeEqual`, guarded on length to avoid its
  throw-on-mismatch and to avoid leaking length via timing.
- **403 (not 401)** — no auth-challenge semantics; add `cache-control: no-store`.
- **Two wrappers** (`protectFetch` + `protectHandler`) because `kit-on-lambda` has both
  fetch-style (stream/bun) and raw-event-style (node buffered) handlers.
- **Internal plumbing package** for docs purposes → `DOCS.md` "no guides" variant **plus** one
  getting-started how-to (it is consumed by adapter authors, so a short guide is warranted);
  ship `docs/how-to` + `DOCS.md` in `files`.
- **Publish as 0.0.0 placeholder first** (new `publish-placeholder-package` skill) to reserve the
  npm name and register the OIDC Trusted Publisher before CI releases, instead of the current
  "first manual real publish" step.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task. After each task, the
user reviews changes and signals "continue".

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check`
3. `cd packages/lambda-function-url-protection && bun test` (per-package, per ADR-003 — never bare root `bun test`)

**Rules for subagents:**

- Each task is self-contained; no commits — leave changes uncommitted for review.
- Follow `.kiro/steering/` (TypeScript overrides: no narrating comments, barrel/`index.ts`
  allowed in this repo, `== null` checks, descriptive array-callback names, oxfmt/oxlint).
- Use `catalog:` for shared external deps; run `bun install` after dep changes and
  `bun run recalculate-dependencies` after intra-repo dep changes.
- Package name == `@beesolve/lambda-function-url-protection`; read `package.json` before any changeset.
- Build tool is bunup (`bun run build`).

## Tasks

### Task 1: Scaffold the package

- [ ] Run `bun run add-package lambda-function-url-protection`.
- [ ] Replace the generated `tsconfig.json` include to list the real entry files and set
      `isolatedDeclarations: false` (match `lambda-keep-active/tsconfig.json`):
      `"include": ["index.ts", "runtime.ts", "shared.ts", "tests/runtime.test.ts"]`.
- [ ] Edit the generated `package.json`: set `"version": "0.0.0"`, add the `./runtime` export and
      keep `.` and `./package.json` (shape from Architecture section), set
      `"files": ["dist", "docs/how-to", "DOCS.md"]`, add `"test": "bun test"` and keep
      `"type-check": "tsc --noEmit"`, add `aws-cdk-lib` + `constructs` to `peerDependencies` and
      `devDependencies` (catalog), add `@types/aws-lambda` (catalog) to `devDependencies`, add
      `typescript` optional peer (mirror `action-tokens`).
- [ ] Update the `bunup.config.ts` entry added by the scaffold to `entry: ["index.ts", "runtime.ts"]`.
- [ ] `bun install`.

**Files:** `packages/lambda-function-url-protection/{package.json,tsconfig.json,index.ts}`, `bunup.config.ts`, `dependencies.json`

**Acceptance criteria:** `bun run type-check` passes (empty `export {}` index still compiles); bunup entry present.

---

### Task 2: Shared contract + runtime wrappers (with tests)

- [ ] Create `shared.ts` exporting `originTokenHeader = "x-origin-token"` and
      `originTokenEnvVar = "ORIGIN_TOKEN"`.
- [ ] Create `runtime.ts` exporting `protectFetch` and `protectHandler` per the Architecture
      section, with the internal `tokensMatch` using `node:crypto.timingSafeEqual` (length-guarded,
      fail-closed on unset/empty expected token). Include a case-insensitive header getter for the
      raw-event path. No token values in logs. No narrating comments.
- [ ] Tests `tests/runtime.test.ts` (`bun test`, `describe`/`it`): - `protectFetch`: valid header → delegates (200 from inner fetch); missing header → 403 with
      `cache-control: no-store`; wrong token → 403; env unset → 403; env empty string → 403. - `protectHandler`: valid header (test both `x-origin-token` and `X-Origin-Token` keys) →
      delegates; missing/wrong → `{ statusCode: 403, ... body: "" }`; env unset/empty → 403. - Set/reset `process.env.ORIGIN_TOKEN` within tests; restore after.

**Files:** `packages/lambda-function-url-protection/{shared.ts,runtime.ts,tests/runtime.test.ts}`

**Acceptance criteria:** `cd packages/lambda-function-url-protection && bun test` green; `bun run check` + `bun run type-check` pass.

---

### Task 3: CDK helper `protectedFunctionUrlOrigin`

- [ ] Implement `index.ts` exporting `protectedFunctionUrlOrigin(props)` and
      `ProtectedFunctionUrlOriginProps` per the Architecture section, importing the contract names
      from `shared.ts`. Logic lifted from `kit-on-lambda`'s `toFunctionUrlOrigin` (Secret → env →
      Function URL `authType: NONE` → `FunctionUrlOrigin` with `x-origin-token` custom header),
      parameterized by `handler`, `invokeMode` (default `RESPONSE_STREAM`), `allowedOrigins`
      (default `["*"]`). No auth-mode option. JSDoc on the exported function and props.
- [ ] Do **not** re-export `./runtime` from `index.ts` (keep the entry points separate, like
      `lambda-keep-active`).

**Files:** `packages/lambda-function-url-protection/index.ts`

**Acceptance criteria:** `bun run type-check` passes; `bun run build` emits `dist/index.js`, `dist/index.d.ts`, `dist/runtime.js`, `dist/runtime.d.ts`.

---

### Task 4: Documentation (DOCS.md, motivation ADR, getting-started)

- [ ] `docs/adr-001-motivation.md` following `.kiro/steering/adrs.md` (Status Accepted;
      Context = unverified token on default Function URL origin; Decision = own both halves of the
      token contract in one package; Rationale incl. fail-closed, constant-time, helper-not-construct;
      Consequences; Alternatives = AWS_IAM+OAC origin, inline-in-kit-on-lambda).
- [ ] `DOCS.md` using the add-package full template (has a how-to): title, `**Keywords:**` line
      (e.g. `origin token, function url protection, protectFetch, protectHandler,
      protectedFunctionUrlOrigin, cloudfront, lambda`), canonical-docs directive blockquote, GitHub
      link, How-To table linking the getting-started guide, "No dedicated sample exists for this
      package yet; see the how-to guides above." in place of Working Examples, Further Reading.
- [ ] `docs/how-to/getting-started.md`: install, the CDK side (`protectedFunctionUrlOrigin` inside
      a `toDefaultOrigin`), the runtime side (`protectFetch` composed in `asResponseStreamHandler`
      and `protectHandler` composed with `keptActive`), and the keep-active ordering caveat. Code
      samples < 30 lines. No fabricated APIs; only the two runtime exports and the one CDK export.
- [ ] Add a row for `@beesolve/lambda-function-url-protection` to the Packages table in root `README.md`.

**Files:** `packages/lambda-function-url-protection/{DOCS.md,docs/adr-001-motivation.md,docs/how-to/getting-started.md}`, `README.md`

**Acceptance criteria:** `DOCS.md` has Keywords line + canonical-docs directive; no dangling links; `files` allowlist already includes `docs/how-to` + `DOCS.md`.

---

### Task 5: Create the publish-placeholder-package skill

- [ ] Create `.kiro/skills/publish-placeholder-package/SKILL.md` adapting the remix skill
      (https://github.com/remix-run/remix/tree/main/.agents/skills/publish-placeholder-package)
      to this repo. Front-matter `inclusion: manual`; name `publish-placeholder-package`;
      description per the pattern of the other SKILL.md files.
- [ ] Adaptations: scope `@beesolve/<name>`; repo `BeeSolve/packages`; workflow file `publish.yml`;
      publish a `0.0.0` placeholder from a `mktemp -d` dir with a minimal `package.json`
      (`publishConfig.access: public`, `repository.directory: packages/<name>`) + short README;
      `npm whoami` / `npm login` (OTP from user if prompted); `npm publish --access public`
      (`--otp` if 2FA); poll `npm view <pkg>@0.0.0 version` until it resolves; then register the
      Trusted Publisher via `npm trust github <pkg> --repo BeeSolve/packages --file publish.yml --yes`
      as the **preferred** path, with the npmjs.org web UI (`/access` → Add Trusted Publisher →
      GitHub Actions, Org `BeeSolve`, Repo `packages`, Workflow `publish.yml`) as the documented
      fallback; verify; `rm -rf "$tmp_dir"`.
- [ ] Note it is a one-time bootstrap; normal releases go through changesets CI; the step is only
      complete once the Trusted Publisher is registered.
- [ ] Update `.kiro/skills/add-package/SKILL.md` step 5/6 and `docs/adding-a-package.md` step 6/7 to
      point at the new placeholder-publish skill (OIDC-before-release) instead of the current
      "first manual real publish". Set the scaffold default version to `0.0.0` to match? — leave
      `add-package.ts` default at `0.1.0` but document that a brand-new package is published as a
      `0.0.0` placeholder first via the skill, then released via changeset. (Document, do not change
      the script in this task.)

**Files:** `.kiro/skills/publish-placeholder-package/SKILL.md`, `.kiro/skills/add-package/SKILL.md`, `docs/adding-a-package.md`

**Acceptance criteria:** skill file present with manual inclusion front-matter and the adapted beesolve values; cross-references updated. (No actual npm publish performed by the subagent.)

---

### Task 6: Changeset + full verification

- [ ] Read `packages/lambda-function-url-protection/package.json` to confirm the exact name, then
      `bunx changeset` → select `@beesolve/lambda-function-url-protection`, `minor`, summary:
      "Initial release: fail-closed origin-token protection for Lambda Function URL behind
      CloudFront (protectFetch/protectHandler runtime wrappers + protectedFunctionUrlOrigin CDK
      helper)."
- [ ] `bun run recalculate-dependencies` (confirms topo order includes the new package).
- [ ] Full gates: `bun run check`, `bun run type-check`, `bun run build`, and per-package
      `cd packages/lambda-function-url-protection && bun test`.

**Files:** `.changeset/*.md`, `dependencies.json`

**Acceptance criteria:** all gates green; changeset committed-ready (uncommitted); build emits all four `dist` artifacts.

---

## Future Work (out of scope)

- **kit-on-lambda adoption**: refactor `toFunctionUrlOrigin` to call
  `protectedFunctionUrlOrigin`, and wrap the four handlers
  (`files/{node,bun}/{handler,stream}.ts`) with `protectFetch` / `protectHandler` in the correct
  order relative to `keptActive`. Add `@beesolve/lambda-function-url-protection` as a dependency
  there. Update kit-on-lambda tests (`test/cdk.test.ts`) and docs.
- **Run the placeholder publish + OIDC registration** for the new package (manual, one-time).
- A dedicated sample stack demonstrating the plain Function URL origin (currently none exists).
