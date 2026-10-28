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
aws-env-resolver --namespace <ns> [options] -- <command...>
```

Put `--namespace` before `--`: Bun strips a leading `--` when no flag precedes it.

| Flag               | Description                                                                    |
| ------------------ | ------------------------------------------------------------------------------ |
| `--namespace <ns>` | Required. Opaque label passed to the config factory and used to key caches.    |
| `--config <path>`  | Config module or JSON (default: `aws-env.config.{ts,js,mjs,json}` in the cwd). |
| `--profile <name>` | AWS profile; overrides the config.                                             |
| `--refresh`        | Bypass caches and re-fetch from AWS.                                           |
| `--purge`          | Delete cached values for this namespace (runs `<command>` only if given).      |
| `--trusted`        | Store keychain items so reads are silent (no prompt).                          |
| `--help`           | Show help.                                                                     |

Exit codes: `0` success, `1` runtime error, `2` invalid arguments. When a command runs, its exit code is returned.

## Library (`@beesolve/aws-env-resolver`)

| Export                | Description                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `resolveEnv`          | `(options: ResolveEnvOptions) => Promise<Record<string, string>>`. Does not mutate `process.env`.               |
| `purgeCache`          | `({ projectKey, namespace, config, secretKeys? }) => Promise<void>`. Deletes the cache file and keychain items. |
| `ResolveEnvOptions`   | `config`, `resources`, `secrets?`, `projectKey`, `namespace`, `refresh?`, `cacheTtlMs?`, `trusted?`.            |
| `ResolverConfig`      | `profile?`, `region`, `stackName`, `secretId?`, `accountId?`, `staticEnv`.                                      |
| `ResourceMapping`     | `envVar`, `logicalIdPrefix`, `resourceType?`, `transform?`.                                                     |
| `SecretMapping`       | `envVar`, `jsonKey?` (defaults to `envVar`).                                                                    |
| `ResourceTransform`   | A function `(physicalId, { region, accountId }) => string` or a `TransformTag`.                                 |
| `TransformTag`        | `{ kind: "lambdaArn" }`, for JSON config.                                                                       |
| `TransformContext`    | `{ region, accountId }`.                                                                                        |
| `EmittedConfig`       | JSON config shape produced by the CDK emitter.                                                                  |
| `emittedConfigSchema` | Valibot schema for `EmittedConfig`.                                                                             |

## CDK (`@beesolve/aws-env-resolver/cdk`)

Requires the optional peers `aws-cdk-lib` and `constructs`.

| Export                    | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `generate`                | `(props: AllowEnvResolutionProps) => EmittedConfig`. Walks the scope; no I/O. |
| `persist`                 | `(config, { path }) => void`. Writes JSON, creating parent directories.       |
| `generateAndPersist`      | `generate` then `persist`; takes `path` in addition to the props.             |
| `AllowEnvResolutionProps` | `projectName`, `namespace`, `scope`, `profile?`, `secrets?`, `staticEnv?`.    |

The emitter reads Lambda `environment` blocks of a single stack. `Ref` and `Fn::GetAtt` `Arn` are supported; other intrinsics throw. It emits a recipe (env var to logical-id prefix), never resolved physical names.

## Config

The CLI loads the first of `aws-env.config.ts`, `.js`, `.mjs`, `.json` in the cwd. A module exports an options object or a `(namespace) => options` factory (sync or async). A JSON file is the CDK-emitted form. Generated config goes to `.json`, hand-written config goes to `.ts`.

When an env var appears in several sources, the later one wins: `config.staticEnv`, then CloudFormation resources, then secrets.

## Caching

- Non-secret values: `os.tmpdir()/aws-env-resolver/<projectKey>-<namespace>-<fingerprint>.json`, 24 hour TTL by default (`cacheTtlMs`).
- Secrets: macOS keychain, service `aws-env-resolver:<projectKey>:<namespace>:<fingerprint>`, one item per secret env var. The fingerprint hashes `region`, `stackName`, and `secretId`, so the cache and keychain share one identity independent of the working directory.
- Default mode stores items with an empty trust list, so macOS may prompt once per secret on read. `--trusted` stores them with `-T /usr/bin/security` for silent reads.
- Steady state makes zero AWS calls.
- On non-macOS platforms there is no secure cache and secrets are fetched on every run.

## IAM permissions

- `cloudformation:DescribeStackResources`
- `secretsmanager:GetSecretValue`
- `sts:GetCallerIdentity`, only when an ARN transform runs without `config.accountId`

See [DOCS.md](./DOCS.md) for the how-to guides.
