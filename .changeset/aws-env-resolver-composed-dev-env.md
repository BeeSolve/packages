---
"@beesolve/aws-env-resolver": minor
---

BREAKING: the dev env is composed in code instead of swept from traced Lambdas.

- CDK: `traceEnv`, `TraceEnvOptions` and `AllowEnvResolutionProps` are removed. `generateDevEnv` and `devEnv` now take `{ projectName, env, profile? }`, where `env` is a plain object built from `envOf(construct)` spreads, literals and `secret({ secretId, jsonKey? })`. Later keys win, so two constructs that set one env var to different resources no longer conflict: spread order chooses. The `secrets` and `staticEnv` options are replaced by `secret(...)` and literals in `env`.
- `envOf` throws, naming both Lambdas, when Lambdas under one construct set a name to different values.
- `generateDevEnv` emits a single `default` target. The emitted JSON shape, the CLI and `--target` are unchanged.
- See ADR-005.
