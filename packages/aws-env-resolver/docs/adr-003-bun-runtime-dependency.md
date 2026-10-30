# ADR-003: Bun as the Runtime Dependency

## Status

Accepted

## Context

`@beesolve/aws-env-resolver` ships two things: a library (`resolveEnv`, caching,
the secret store, the AWS calls) imported by other code, and a CLI
(`aws-env-resolver -- <command>`) that resolves the environment, injects it into
`process.env`, and spawns a child command that inherits it.

The monorepo convention is that published packages "target both Bun and Node.js
consumers." This package needs two runtime capabilities that sit at the boundary
between the two runtimes:

1. **Spawning child processes** - the keychain backend shells out to
   `/usr/bin/security`, and the CLI spawns the wrapped command with a merged env,
   inherited stdio, a proxied exit code, and forwarded `SIGINT`/`SIGTERM`.
2. **Loading the consumer's config at runtime** - the CLI imports a committed
   `aws-env.config.{ts,js,mjs,json}`. The hand-authored form is **TypeScript**
   (`aws-env.config.ts`) so the config can use `transform` functions and computed
   values.

Both capabilities exist on Node too, but the second one is where the runtimes
diverge: Bun imports a `.ts` module natively, while Node cannot import an
arbitrary `.ts` file without a loader. Supporting Node for the CLI would mean
either restricting consumers to `.json`/`.js`/`.mjs` config or detecting and
wiring a TypeScript loader (`--experimental-strip-types`, `tsx`, ...) with the
edge cases that entails.

## Decision

Bun is the concrete runtime dependency for this package. The CLI shebang is
`#!/usr/bin/env bun`, child processes are spawned with `Bun.spawn`, and the
keychain runner invokes `/usr/bin/security` via `Bun.spawn`. The package does
**not** provide a Node fallback runner or a Node-compatible config loader.

A single injected `SecurityRunner` seam exists in `keychain.ts` (the default uses
`Bun.spawn`) - this is for test injection, not a supported Node backend.

## Rationale

### 1. The CLI already needs Bun to load a `.ts` config for free

The headline consumer workflow is rewriting a script to
`aws-env-resolver --stage <stage> -- <command>` and authoring an
`aws-env.config.ts` that can contain `transform` functions (e.g. a Lambda name to
an ARN). A function cannot live in JSON, so the hand-written config is TypeScript.
Bun imports `.ts` natively; Node does not. Choosing Bun makes the most ergonomic
config form work with zero extra machinery.

### 2. This is a developer-local tool, not a deployed runtime artifact

The CLI runs on a developer's machine to boot a local dev server, and the
`@beesolve` toolchain already standardizes on Bun for scripts and local tooling.
Requiring Bun here costs nothing a contributor does not already have, and avoids
shipping a second, less-tested execution path purely for a runtime no one in the
workflow uses.

### 3. `Bun.spawn` covers the child-process requirements directly

Merged env, `stdio: "inherit"`, awaiting the child's exit code, and signal
forwarding are all first-class in `Bun.spawn`. A Node implementation via
`node:child_process` is possible but would be a parallel code path to maintain and
test for no consumer benefit.

### 4. A Node fallback would add surface area with little payoff

A portable runner plus a Node TypeScript-config loader is strictly more code,
more branching, and more failure modes (which loader is present? which TS
features are supported by type-stripping?). The honest tradeoff is that the small
portability win does not justify the ongoing maintenance and test cost for a
local-only tool.

## Consequences

- Running the `aws-env-resolver` CLI requires Bun on the developer's machine. This
  is stated prominently in `DOCS.md` and the getting-started guide.
- A consumer who imports the library API (`resolveEnv`) rather than the CLI still
  executes `Bun.spawn` in the default keychain runner on macOS, so the library
  path is also Bun-first in practice. A caller on another runtime would have to
  supply its own `SecurityRunner`; this is not a documented or supported mode.
- The secure-secret cache is already macOS-only (see the keychain policy); the Bun
  requirement is an additional, orthogonal environment constraint on the CLI.
- If a future consumer genuinely needs a Node CLI, the injected `SecurityRunner`
  seam and the pure, runtime-agnostic core (cache, emit, AWS resolution) mean a
  Node backend could be added later without reworking the core - but that is
  explicitly out of scope today.

## Alternatives Considered

### Make the library runtime-agnostic, keep the CLI on Bun

Swap the default keychain runner to `node:child_process` so the library runs on
Node or Bun, while the CLI stays Bun-first. Rejected for now because the primary
consumer of this package is the CLI, the keychain backend is macOS-only anyway,
and keeping one spawn mechanism (`Bun.spawn`) everywhere is simpler. The seam to
do this later is deliberately preserved (injected `SecurityRunner`).

### Make both layers Node-capable

Use `node:child_process` throughout, change the shebang to `node`, and load `.ts`
config via `--experimental-strip-types` or a detected loader. Rejected: it
departs from the toolchain's Bun standard, forces either a TS-loader dependency or
a `.json`-only restriction for Node users, and multiplies the config-loading edge
cases - all to serve a runtime the workflow does not use.

### Restrict config to `.json`/`.js`/`.mjs` to stay Node-compatible

Drop support for hand-written `.ts` config so Node could load it. Rejected because
`.ts` config with `transform` functions is a core ergonomic of the manual-config
path; a declarative `.json` config is already supported for the CDK-emitted form,
and forcing everyone onto it would remove the ability to express function
transforms.

## Future Possible Work

Node.js compatibility is intentionally cheap to add later. The Bun surface is small
and sits behind seams, so a future port is a leaf change, not a core rewrite:

1. **Keychain runner (trivial).** `defaultSecurityRunner` is the only `Bun` API on
   disk and is already abstracted behind the injected `SecurityRunner` type. Swap
   its body from `Bun.spawn` to `node:child_process` (`execFile`/`spawn`); the
   `SecurityRunResult` signature and every call site stay unchanged.
2. **Child spawn (`spawn.ts`, small).** `Bun.spawn(cmd, { env, stdio: "inherit" })`
   with exit-code proxying and `SIGINT`/`SIGTERM` forwarding maps one-to-one to
   `node:child_process.spawn` with a `close`/`exit` listener and signal
   re-forwarding. Equivalent shape, either a swap or a runtime branch.
3. **Config loading (the only real design call).** Bun imports `aws-env.config.ts`
   natively; Node needs a loader. The repo targets Node 24, whose native
   type-stripping handles the common config form (a plain object or factory plus
   `transform` functions survive stripping untouched), which largely defuses this.
   The fallback is to restrict Node users to `.json`/`.js`/`.mjs` - the `.json`
   CDK-emitted form needs no TypeScript loader at all.
4. **Everything else already runs on Node.** `cache.ts` uses only
   `node:crypto`/`node:fs`/`node:os`/`node:path`; `emit.ts`, the AWS clients, the
   secret store, and the type layer touch no Bun APIs. Only the `bun:test` harness
   is Bun-specific, and that is a test concern, not a shipped-runtime one.

If this is pursued, write a new ADR superseding the runtime decision rather than
editing this one, and keep the `SecurityRunner` seam and the pure core intact.

## References

- [`Bun.spawn`](https://bun.sh/docs/api/spawn)
- [Node.js: running TypeScript natively](https://nodejs.org/api/typescript.html) - the type-stripping constraints that make a Node CLI config loader non-trivial
