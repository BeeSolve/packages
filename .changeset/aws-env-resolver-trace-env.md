---
"@beesolve/aws-env-resolver": minor
---

BREAKING: trace Lambdas explicitly with `traceEnv` and split runtimes with targets.

- CDK: `generate` and `generateAndPersist` no longer sweep every Lambda under the scope. Mark what the local process needs with `traceEnv(construct, { target? })`, where `construct` is a Lambda or any construct containing Lambdas (a gateway, a site, a stack). Nothing is passed through stacks. `traceEnv(app)` restores the old "everything" behavior. `scope` now only limits where markers are searched, and `generate` throws when nothing is marked.
- Targets: `traceEnv(x, { target: "web" })` groups constructs into named targets (default: `default`). Each target is emitted and conflict-checked on its own, so the same env var may differ between targets. Conflict errors name the target.
- Emitted JSON is now `{ projectKey, targets: { <name>: { config, resources, secrets } } }`. `EmittedConfig` changes shape, `EmittedTarget`, `emittedTargetSchema` and `defaultTarget` are new exports. A flat pre-targets JSON file still loads as the `default` target.
- CLI: new `--target <name>`, optional when the config has exactly one target. A `.ts` config factory receives `(stage, target)`.
- Library: `ResolveEnvOptions.target` and `purgeCache({ target })`. A non-default target gets its own resource cache file; existing caches and keychain items keep their identity.
