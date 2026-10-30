# @beesolve/aws-env-resolver

## 0.4.0

### Minor Changes

- 53e76de: BREAKING: rename `namespace` to `stage` and make it optional, with one config file per stage.

  - CLI: `--namespace <ns>` is now `--stage <stage>`, optional. With `--stage stg` the CLI loads `aws-env.config.stg.{ts,js,mjs,json}` first, then falls back to `aws-env.config.{ts,js,mjs,json}`. A config factory receives the stage (or `undefined`).
  - Library: `ResolveEnvOptions.namespace` and `purgeCache({ namespace })` are now an optional `stage`. Without it, caches and keychain items use the label `default`. Existing caches stay valid when you pass the same value as before.
  - CDK: `generateAndPersist({ stage })` writes `aws-env.config.<stage>.json` by default (`path` still overrides it). New `defaultConfigPath(stage?)` export.
  - Stages are limited to letters, digits, `.`, `_` and `-`, since they end up in file names and keychain service names.
  - Fix: `aws-env-resolver -- <command>` without flags no longer fails. Bun drops the leading `--`, so the CLI now treats a first argument that is not a flag as the start of the command.

- 53e76de: BREAKING: trace Lambdas explicitly with `traceEnv` and split runtimes with targets.

  - CDK: `generate` and `generateAndPersist` no longer sweep every Lambda under the scope. Mark what the local process needs with `traceEnv(construct, { target? })`, where `construct` is a Lambda or any construct containing Lambdas (a gateway, a site, a stack). Nothing is passed through stacks. `traceEnv(app)` restores the old "everything" behavior. `scope` now only limits where markers are searched, and `generate` throws when nothing is marked.
  - Targets: `traceEnv(x, { target: "web" })` groups constructs into named targets (default: `default`). Each target is emitted and conflict-checked on its own, so the same env var may differ between targets. Conflict errors name the target.
  - Emitted JSON is now `{ projectKey, targets: { <name>: { config, resources, secrets } } }`. `EmittedConfig` changes shape, `EmittedTarget`, `emittedTargetSchema` and `defaultTarget` are new exports. A flat pre-targets JSON file still loads as the `default` target.
  - CLI: new `--target <name>`, optional when the config has exactly one target. A `.ts` config factory receives `(stage, target)`.
  - Library: `ResolveEnvOptions.target` and `purgeCache({ target })`. A non-default target gets its own resource cache file; existing caches and keychain items keep their identity.

## 0.3.0

### Minor Changes

- 54af02b: Support env vars built with `Fn::Join` from literal text and resources (for example a JSON string embedding a queue url): the CDK emitter writes a template mapping with `parts`, and the resolver concatenates the resolved values. Hand-written `.ts` configs may use `{ envVar, parts }` too, and `stackName` on a mapping is no longer dropped when loading a `.ts` config.

  The CDK emitter now reports every env var it cannot emit in a single error instead of stopping at the first one.

## 0.2.0

### Minor Changes

- 8c8703b: CDK emitter supports multiple stacks (same region): every stack with Lambda environment variables is emitted, `config.stackName` may be a list, and resource mappings may carry a `stackName`. `namespace` is removed from `AllowEnvResolutionProps` (it was unused), and `generateAndPersist` `path` is optional (default `aws-env.config.json`).

  `scope` also accepts an array of constructs (e.g. a list of stacks), and pseudo-parameter `Fn::Join` values such as default event bus ARNs are inlined as static env.

## 0.1.0

### Minor Changes

- 4e98ebd: Initial release: resolve local dev env from CloudFormation + Secrets Manager, cache non-secrets in the OS temp dir and secrets in the macOS keychain (interactive by default, optional `--trusted`), inject into a spawned command, and optionally emit the config from a CDK app via `./cdk`.
