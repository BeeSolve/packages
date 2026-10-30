# @beesolve/aws-env-resolver - Documentation

**Keywords:** aws env, local development env, dev server env, resolveEnv, purgeCache, traceEnv, targets, generate, persist, generateAndPersist, aws-env.config.ts, aws-env-resolver, secrets manager, cloudformation, macos keychain, cdk config emit, inject environment, child process

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/aws-env-resolver

Resolves a local development environment from CloudFormation resources and Secrets Manager, caches it, and injects it into a command you run.

> **macOS-only secure cache.** Secrets are cached in the macOS login keychain. On any other platform there is no secure cache: secrets are fetched from Secrets Manager on every run and held only in the child process environment, never written to disk.

> **Requires Bun.** The CLI runs with `#!/usr/bin/env bun`.

## How-To Guides

| Guide                                                               | Description                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Getting Started](./docs/how-to/getting-started.md)                 | Install, wrap a command, refresh and purge caches, keychain modes                      |
| [Define a Project Config](./docs/how-to/define-a-project-config.md) | Author `aws-env.config.ts` by hand: stack, resources, secrets, static env              |
| [Emit Config from CDK](./docs/how-to/emit-config-from-cdk.md)       | Trace Lambdas with `traceEnv` and emit `aws-env.config.json` with `generateAndPersist` |

## Working Examples

No dedicated sample exists for this package yet; see the how-to guides above.

## Further Reading

- [README](./README.md) - API reference and configuration
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/aws-env-resolver/docs) (GitHub only)
