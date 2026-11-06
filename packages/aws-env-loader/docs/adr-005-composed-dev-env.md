# ADR-005: The Dev Env Is Composed, Not Swept

## Status

Accepted. Supersedes the `traceEnv` part of ADR-004. Targets in the emitted JSON and the CLI stay as ADR-004 describes them; `generateDevEnv` now emits exactly one (`default`).

## Context

ADR-002 and ADR-004 derived the local env by reading the environment of Lambda functions (all of them, then only marked ones) and flattening it into one `envVar -> resource` map. That models a process env as the union of several Lambdas' envs, and it throws when two Lambdas set one name to different resources.

A local dev server is not a Lambda fleet. It is one process that mounts several handlers behind one origin and fakes what AWS would provide (sessions, synchronous task invocation instead of SQS). Its env only has to be right for that process. Embedding constructs from other packages (an auth gateway with its own `SqsHandler` and `ActionTokens`) makes unrelated Lambdas set the same names, for example `BEESOLVE_TASKS_MAIN_QUEUE_URL`, to different resources.

Those names are read once at import time by the packages (`v.parse(envSchema, process.env)` at module top level), and ES modules are singletons. One process therefore cannot see two values for one name through any runtime scoping, and prefixing at the source would need every reader to change.

## Decision

1. The dev env is a plain object the project composes in code:

   ```ts
   devEnv({
     projectName,
     stage,
     profile,
     env: {
       ...envOf(auth),
       ...envOf(api),
       BASE_URI: "https://local.test:3000",
       API_KEY: secret({ secretId }),
     },
   });
   ```

2. `envOf(construct)` returns the env of the Lambda(s) under a construct as values: literals stay strings, intrinsics become `{ kind: "resource", ... }`. It throws if Lambdas under the construct disagree on a name, naming both.
3. `secret({ secretId, jsonKey? })` marks a Secrets Manager value. It replaces the `secrets` option and is emitted as the same secret mapping a `{{resolve:secretsmanager:...}}` dynamic reference already produces.
4. Spread order is precedence: a later key replaces an earlier one. There is no conflict error between `envOf` calls because an object cannot hold a key twice.
5. Literals in `env` replace `staticEnv`. `traceEnv`, the construct markers, `TraceEnvOptions`, `AllowEnvResolutionProps` and the `secrets` and `staticEnv` props are removed.

## Rationale

### 1. Collisions are a choice, not an error

When two embedded constructs need the same name for different resources, the project knows which one the dev process should use (or that it does not matter, for example with a local synchronous task runner). Writing that as spread order is visible, reviewable, and needs no new concept.

### 2. Overrides and extras live in the same place

`STAGE`, `BASE_URI` and local-only flags differ from deployed values by design. They sit in the same object instead of a separate override file with its own merge rules.

### 3. No change in the packages that read env

The fix lives entirely in the project's `app.ts`. Nothing is prefixed or scoped at runtime, so the import-time reads and the module-singleton problem do not matter.

### 4. Existing machinery is kept

The intrinsic rules, inline pseudo-parameter handling, the CLI, caches and keychain store are unchanged. Only the front end that collects entries is replaced.

## Consequences

- Breaking for `0.x`: the CDK API changes completely. Emitted JSON is unchanged.
- The project lists the constructs whose env the dev process needs. A forgotten one fails at run time with a missing env var, as with `traceEnv`.
- `envOf(auth)` on a gateway whose inner Lambdas disagree throws. Pass a narrower construct, for example `auth.node.findChild("Api")`. A named marker (`exposeEnv(fn, "label")`) can be layered on later as another way to find a construct, without changing `envOf` or `generateDevEnv`.
- `generateDevEnv` needs at least one `envOf` value to learn the stack and region. At most one `secretId` is supported, as before.
- Single-process dev servers get one env. Running several processes with different env means calling `generateDevEnv` per process and writing separate files; first-class multiple targets from one call are gone.

## Alternatives Considered

### Prefix env vars at the source or per construct

Needs every package that reads env at import time to change, and only helps modules not shared by both sides.

### Runtime scoping (`AsyncLocalStorage` plus a `process.env` proxy, or a temporary env swap around a dynamic import)

Measured in Bun: `AsyncLocalStorage` context does not reach module evaluation, and a swap fixes import-time reads but not modules cached by an earlier importer. Order dependent and fragile.

### One process per target

Correct by construction, but the project wants a single process.

### `prefer` per variable on top of `traceEnv`

A narrow escape hatch for one symptom. Spread order does the same with no new API.

## References

- ADR-002: CDK Config Emission
- ADR-004: Explicit Env Tracing and Targets
