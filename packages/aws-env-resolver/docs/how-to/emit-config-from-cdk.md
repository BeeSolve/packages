# How to: Emit the config from a CDK app

## Prerequisites

- A CDK app (`aws-cdk-lib` and `constructs`) whose Lambdas receive the env vars you want locally
- `@beesolve/aws-env-resolver` installed, see [Getting Started](./getting-started.md)
- A stack with an explicit `env.region` and `stackName`

## Steps

### 1. Emit from the app entry file

`generateAndPersist` walks the scope, reads every Lambda's `environment`, and writes `aws-env.config.json`. Guard it with a flag so it runs only when asked.

```ts
import { generateAndPersist } from "@beesolve/aws-env-resolver/cdk";
import { App } from "aws-cdk-lib";

const app = new App();
const stack = new ExampleStack(app, "ExampleStack", {
  stackName: "example-stack",
  env: { region: "eu-central-1" },
});

if (process.env.EMIT_ENV_CONFIG != null) {
  generateAndPersist({
    projectName: "example-app",
    scope: stack,
    profile: "example-profile",
    secrets: [{ secretId: "example/secrets", envVars: ["API_KEY", "SIGNING_KEY"] }],
    staticEnv: { BASE_URI: "https://example.test:3000" },
    path: "aws-env.config.json", // optional, this is the default
  });
}
```

Run it with `EMIT_ENV_CONFIG=1 bunx cdk synth`.

### 2. Pick purity or convenience

- `generate(props)` returns the config without any I/O, for inspecting or merging.
- `persist(config, { path })` writes a config as JSON.
- `generateAndPersist({ ...props, path })` is `persist(generate(props), { path })`.

### 3. Use the result

Commit `aws-env.config.json` and run the CLI as in [Getting Started](./getting-started.md). The loader picks up `.json` automatically.

## What it infers and what it does not

- Literal env values become `staticEnv`.
- `Ref` becomes a mapping on the stable logical-id prefix (the CDK hash suffix is stripped).
- `Fn::GetAtt` on `Arn` becomes a mapping with the `{ kind: "lambdaArn" }` tag.
- `Fn::Join` mixing literal text with the above becomes a template mapping (`parts`: literals and resource references), resolved by concatenation, e.g. a JSON string embedding a queue url.
- Any other intrinsic or attribute throws. Pass the value through `staticEnv` or write a `.ts` config by hand.
- Secrets are never discovered. List them in `secrets`; those env vars are dropped from the walked result. At most one `secretId` is allowed.
- Env vars set by third-party constructs that are not plain values on your Lambdas are not seen. Add them through `staticEnv` or a hand-written config.
- A walked env var also listed in `staticEnv` is taken from `staticEnv`.
- With several stacks, `config.stackName` is a list and each resource mapping records the `stackName` it belongs to.

## The synth boundary

At synth time physical names are unresolved tokens, so the emitter writes the recipe (env var to logical-id prefix) and never real names. The resolver fills in real values from the deployed stack when you run your command.

## Common Pitfalls

- Every stack under the scope with Lambda environment variables is included (stacks whose Lambdas have none, such as Lambda@Edge, are skipped). If the included stacks span several regions, `generate` throws; pass the stacks you want as `scope`.
- `scope` accepts an `App`, `Stage`, `Stack`, or an array of them, e.g. `scope: [apiStack, commonStack]`. Stacks you leave out are ignored.
- `Ref` to `AWS::Partition`, `AWS::Region`, `AWS::AccountId` and `AWS::URLSuffix` is substituted from the stack, and a `Fn::Join` that becomes fully literal is emitted as a static value (e.g. a default event bus ARN).
- An unresolved region or stack name throws; set `env.region` and `stackName` on the stack.
- No Lambda under the scope throws.
- The same env var with different values on different Lambdas throws as a conflict.

## See Also

- [Define a Project Config](./define-a-project-config.md)
- [Getting Started](./getting-started.md)
- [README](../../README.md)
