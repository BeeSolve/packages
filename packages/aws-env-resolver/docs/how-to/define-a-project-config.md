# How to: Define a project config by hand

## Prerequisites

- `@beesolve/aws-env-resolver` installed, see [Getting Started](./getting-started.md)
- A deployed CloudFormation stack and, optionally, a Secrets Manager secret holding a JSON object of string values

## Steps

### 1. Understand what the config is

The package knows how to resolve an environment, but not what your project needs. `aws-env.config.ts` is the bridge: a file you write and commit in your repo that names the stack, which resources map to which env vars, which secret keys map to which env vars, and the static values. It contains no secret values, only names and mappings, so it is safe to commit.

### 2. Write `aws-env.config.ts`

Export an options object, or a function from stage to options (sync or async; it also receives the `--target` value as a second argument). Use a factory when the stage selects the stack or secret. The factory receives `undefined` when the CLI runs without `--stage`; throw if your project needs one. Alternatively keep one file per stage, `aws-env.config.<stage>.ts`, which `--stage <stage>` picks before `aws-env.config.ts`.

```ts
import type { ResolveEnvOptions } from "@beesolve/aws-env-resolver";

type ProjectConfig = Omit<ResolveEnvOptions, "stage" | "refresh" | "trusted">;

export default (stage: string | undefined): ProjectConfig => {
  if (stage == null) {
    throw new Error("Pass --stage");
  }
  return {
    projectKey: "example-app",
    config: {
      profile: "example-profile",
      region: "eu-central-1",
      stackName: `example-stack-${stage}`,
      secretId: `example/secrets-${stage}`,
      staticEnv: { BASE_URI: "https://example.test:3000" },
    },
    resources: [
      { envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data", resourceType: "AWS::DynamoDB::Table" },
      {
        envVar: "SDK_HANDLER_ARN",
        logicalIdPrefix: "SdkHandler",
        resourceType: "AWS::Lambda::Function",
        transform: { kind: "lambdaArn" },
      },
    ],
    secrets: [{ envVar: "API_KEY" }, { envVar: "SIGNING_KEY", jsonKey: "signingKey" }],
  };
};
```

### 3. Know how each part resolves

- A resource is matched by the first stack resource whose logical id starts with `logicalIdPrefix` (and whose type equals `resourceType` when given). The env var gets its physical id.
- `transform` is either a function `(physicalId, { region, accountId }) => string` or the tag `{ kind: "lambdaArn" }`. The account id comes from `config.accountId` or is looked up through STS only when a transform needs it.
- A secret key is read from the JSON secret under `jsonKey`, which defaults to `envVar`.
- When an env var appears in several places, the later source wins: `staticEnv`, then resources, then secrets.

### 4. Choose the file type

Generated config goes to `.json`, hand-written config goes to `.ts`. Lookup order in the current directory is `aws-env.config.<stage>.ts`, `.js`, `.mjs`, `.json` (only with `--stage`), then `aws-env.config.ts`, `.js`, `.mjs`, `.json`. A `.json` file cannot hold functions, so use the `{ kind: "lambdaArn" }` tag there.

## Common Pitfalls

- `projectKey`, the stage, region, stack name, and secret id form the cache identity. Changing the stack or secret creates fresh cache entries.
- Only one `secretId` per config.
- Never put secret values in `staticEnv`; it is committed.

## See Also

- [Getting Started](./getting-started.md)
- [Emit Config from CDK](./emit-config-from-cdk.md)
- [README](../../README.md)
