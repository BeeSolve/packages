# How to: Get started with aws-env-resolver

## Prerequisites

- Bun installed (the CLI runs with `#!/usr/bin/env bun`)
- An AWS profile with read access to the stack and secret (see Common Pitfalls)
- A committed config file, see [Define a Project Config](./define-a-project-config.md) or [Emit Config from CDK](./emit-config-from-cdk.md)
- macOS for the secure secret cache. On other platforms secrets are fetched on every run and never cached.

## Steps

### 1. Install

```sh
bun add -d @beesolve/aws-env-resolver
```

```sh
npm install --save-dev @beesolve/aws-env-resolver
```

### 2. Wrap your command

Put `--namespace` before `--`. Bun strips a leading `--` when no flag precedes it, so the namespace flag must come first.

```json
{
  "scripts": {
    "dev": "aws-env-resolver --namespace example-dev -- bun --hot dev.tsx"
  }
}
```

The resolver loads `aws-env.config.ts`, `.js`, `.mjs`, or `.json` from the current directory (in that order), resolves the environment, sets it on the process, and runs your command with it. Pass `--config <path>` to use another file.

### 3. Control caching

```sh
aws-env-resolver --namespace example-dev --refresh -- bun --hot dev.tsx
aws-env-resolver --namespace example-dev --purge
aws-env-resolver --namespace example-dev --trusted -- bun --hot dev.tsx
```

- `--namespace <ns>` is required. It is passed to a config factory and keys the caches. The package never interprets its value.
- `--refresh` bypasses the caches, re-fetches from AWS, and rewrites them.
- `--purge` deletes the cached file and the keychain items for this namespace. With no command after `--` it exits; with one, it then resolves and runs the command.
- `--trusted` is an independent opt-in. Items are stored with `-T /usr/bin/security`, so later reads are silent. The default stores them with an empty trust list, so macOS may prompt (once per secret) when the items are read. Trusted mode trades those prompts for any process running as you being able to read the items through `security`.
- `--profile <name>` overrides the profile from the config.

Exit codes: `0` success, `1` runtime error, `2` invalid arguments. Otherwise the exit code is the child's.

### 4. Same repo in two checkouts

The cache file and the keychain service are keyed on `projectKey`, `namespace`, and a fingerprint of `region`, `stackName`, and `secretId`, never on the directory.

- Two checkouts pointed at the same stack, region, and secret share one cache and one set of keychain items. The values are identical, so sharing avoids a duplicate fetch and prompt.
- If one checkout points at a different stack or secret, its fingerprint differs and it gets separate entries. Neither overwrites the other.
- To isolate two checkouts of the same stack on purpose, use a different `--namespace` in each.

### 5. Use it from code

```ts
import { resolveEnv } from "@beesolve/aws-env-resolver";

const env = await resolveEnv({
  projectKey: "example-app",
  namespace: "example-dev",
  config: {
    region: "eu-central-1",
    stackName: "example-stack",
    staticEnv: {},
  },
  resources: [{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }],
});
```

`resolveEnv` returns a flat record and does not modify `process.env`.

## Common Pitfalls

- Put `--namespace` before `--`, otherwise Bun swallows the separator.
- The profile needs `cloudformation:DescribeStackResources` and `secretsmanager:GetSecretValue`. `sts:GetCallerIdentity` is needed only when an ARN transform runs and the config has no `accountId`.
- A resource that matches no logical-id prefix fails with an error naming the env var and the prefix.
- A secret must be a JSON object whose values are all strings.
- On non-macOS platforms every run calls Secrets Manager.

## See Also

- [Define a Project Config](./define-a-project-config.md)
- [Emit Config from CDK](./emit-config-from-cdk.md)
- [README](../../README.md) - API reference
