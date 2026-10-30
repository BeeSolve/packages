---
"@beesolve/aws-env-resolver": minor
---

BREAKING: rename `namespace` to `stage` and make it optional, with one config file per stage.

- CLI: `--namespace <ns>` is now `--stage <stage>`, optional. With `--stage stg` the CLI loads `aws-env.config.stg.{ts,js,mjs,json}` first, then falls back to `aws-env.config.{ts,js,mjs,json}`. A config factory receives the stage (or `undefined`).
- Library: `ResolveEnvOptions.namespace` and `purgeCache({ namespace })` are now an optional `stage`. Without it, caches and keychain items use the label `default`. Existing caches stay valid when you pass the same value as before.
- CDK: `generateAndPersist({ stage })` writes `aws-env.config.<stage>.json` by default (`path` still overrides it). New `defaultConfigPath(stage?)` export.
- Stages are limited to letters, digits, `.`, `_` and `-`, since they end up in file names and keychain service names.
- Fix: `aws-env-resolver -- <command>` without flags no longer fails. Bun drops the leading `--`, so the CLI now treats a first argument that is not a flag as the start of the command.
