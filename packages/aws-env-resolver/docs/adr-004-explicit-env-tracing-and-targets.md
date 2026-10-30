# ADR-004: Explicit Env Tracing and Targets

## Status

Accepted. Supersedes the "walk every Lambda under the scope" part of ADR-002.

## Context

ADR-002 made `generate` read the environment of every Lambda function under a scope and flatten all of them into one `envVar -> resource` map. That models one process environment, and it throws when one env var name points at two resources.

Real stacks break that model in two ways:

- Unrelated Lambdas contribute env vars the local process never needs. Two instances of the same construct (for example an app's own `ActionTokens` table and the one inside the auth service) both set `BEESOLVE_ACTION_TOKENS_TABLE_NAME` to different tables. Each Lambda is correct; the flattened map is not.
- Projects may run several local processes (a SvelteKit dev server and a worker script) that legitimately need different values.

Exporting the handful of Lambdas you care about from stacks to a central list is plumbing nobody wants, and L3 constructs from other packages do not expose their inner functions.

## Decision

1. `generate` emits only Lambdas under constructs marked with `traceEnv(construct, { target? })`. The marker can be placed anywhere a construct is in hand, with no object passed through stacks. A marked construct contributes every `CfnFunction` in its subtree. `traceEnv(app)` traces everything. `scope` only limits where markers are searched.
2. A marker may name one or more targets; the default is `default`. Each target is built and conflict-checked independently.
3. The emitted JSON becomes `{ projectKey, targets: { <name>: { config, resources, secrets } } }`. The CLI takes `--target <name>`, optional when the file has exactly one target. A flat pre-targets JSON file still loads as the `default` target.
4. Resource caches are keyed by target (non-default only) so targets that share a stack never read each other's cached values. The keychain identity is unchanged.

## Rationale

### 1. Allowlist beats sweep

Tracing is opt-in at the place that knows whether a Lambda matters. A forgotten marker fails loudly at run time with a missing env var, and an empty marker (no Lambda inside) fails at synth. The old sweep failed on correct code.

### 2. The marker lives on the construct

The marker is stored on the construct under `Symbol.for("@beesolve/aws-env-resolver/trace")` and read back with `Reflect.get`, validated by Valibot. This needs no shared registry, so nothing is threaded through stacks, and `Symbol.for` keeps it working if two copies of the package end up installed (a module-level registry would silently split in that case). Construct node metadata was rejected because it can end up in the cloud assembly.

### 3. Targets map to runtimes, not to files

One JSON file per stage with a `targets` map avoids a new file-name segment. Stage names may contain dots, so `aws-env.config.<stage>.<target>.json` would be ambiguous.

### 4. Cache identity includes the target only when it is not the default

Existing caches and keychain items for single-target projects keep their identity. The target is added to the cache file's fingerprint only when set.

## Consequences

- Breaking for `0.x`: `generate` throws when nothing is marked, the emitted JSON shape changes, and `buildEmittedConfig` became `buildEmittedTarget` (internal).
- Processes that share one `process.env`, like a single Bun dev server running api, payments and auth, must share a target. Two instances of a construct that both set the same env var to different resources still conflict inside one target; the fix is a distinct env var name in the source, `staticEnv`, or another target.
- `secrets` and `staticEnv` apply to every target. At most one `secretId` per target.
- `traceEnv` takes a construct that contains the function. A wrapper that only references it (a function URL) has no function in its subtree and throws.
- Target names are not type-checked against the CLI flag, since the JSON is read at run time. A project can type its own names with an `as const` tuple.

## Alternatives Considered

### Pass a resolver instance into stacks

Explicit, but it grows every stack's props and cannot reach Lambdas created inside other packages' constructs.

### Filter or exclude predicate on `generate`

Keeps the sweep and subtracts from it. It is stringly typed on construct paths and drifts when new Lambdas are added.

### Per-variable override for conflicts

A narrow escape hatch for one symptom. Targets and `staticEnv` already cover it, so it was not added.

### One file per target

Ambiguous with dotted stage names and multiplies committed files.

## References

- ADR-002: CDK Config Emission
