# How to: Emit the config from a CDK app

## Prerequisites

- A CDK app (`aws-cdk-lib` and `constructs`) whose Lambdas receive the env vars you want locally
- `@beesolve/aws-env-loader` installed, see [Getting Started](./getting-started.md)
- A stack with an explicit `env.region` and `stackName`

## Steps

### 1. Compose the env the local process needs

The env is a plain object. `envOf(construct)` returns the environment of a Lambda, or of every Lambda under a construct (an auth gateway, a SvelteKit site, a whole stack). Spread what you need, then add literals and secrets.

```ts
import { envOf, devEnv, secret } from "@beesolve/aws-env-loader/cdk";

const { api, auth, payments } = new ApiStack(app, "ApiStack", {
  stackName: "example-api",
  env: { region: "eu-central-1" },
});

devEnv({
  projectName: "example-app",
  stage: "dev", // writes aws-env.config.dev.json; run the CLI with --stage dev
  profile: "example-profile",
  env: {
    ...envOf(auth),
    ...envOf(payments),
    ...envOf(api),
    STAGE: "dev",
    BASE_URI: "https://example.test:3000",
    API_KEY: secret({ secretId: "example/secrets" }),
    SIGNING: secret({ secretId: "example/secrets", jsonKey: "signingKey" }),
  },
});
```

- Later keys win, so spread order is precedence. Above, `api` beats `auth` and `payments` for any name they share. This is how you choose between two embedded constructs that set the same env var to different resources.
- Literals replace the deployed value, which is how local-only values like `STAGE` or `BASE_URI` are set.
- `secret({ secretId, jsonKey? })` reads a Secrets Manager value; `jsonKey` defaults to the env var name. At most one `secretId` is allowed.
- Lambdas you do not pass to `envOf` are ignored.

Guard the call so it runs only when asked, since it also runs on every `cdk synth`:

```ts
if (process.env.EMIT_ENV_CONFIG != null) {
  devEnv({/* ... */});
}
```

Run it with `EMIT_ENV_CONFIG=1 bunx cdk synth`.

- `generateDevEnv(props)` returns the config without any I/O, for inspecting or merging.
- `persistDevEnv(config, { path })` writes a config as JSON.
- `devEnv({ ...props, stage, path })` is `persistDevEnv(generateDevEnv(props), { path: path ?? defaultConfigPath(stage) })`.

### 2. Use the result

Commit `aws-env.config.<stage>.json` and run the CLI as in [Getting Started](./getting-started.md). The loader picks up `.json` automatically.

## What it infers and what it does not

- Literal env values become `staticEnv`.
- `Ref` becomes a mapping on the stable logical-id prefix (the CDK hash suffix is stripped).
- `Fn::GetAtt` on `Arn` becomes a mapping with the `{ kind: "lambdaArn" }` tag.
- `Fn::Join` mixing literal text with the above becomes a template mapping (`parts`: literals and resource references), resolved by concatenation, e.g. a JSON string embedding a queue url.
- A `{{resolve:secretsmanager:...}}` dynamic reference on a Lambda (from `secret.secretValueFromJson(key)`) becomes a secret mapping.
- Any other intrinsic or attribute throws. Pass the value as a literal in `env` or write a `.ts` config by hand.
- With several stacks, `config.stackName` is a list and each resource mapping records the `stackName` it belongs to.

## The synth boundary

At synth time physical names are unresolved tokens, so the emitter writes the recipe (env var to logical-id prefix) and never real names. The loader fills in real values from the deployed stack when you run your command.

## Common Pitfalls

- Nothing is emitted for a Lambda you did not pass to `envOf`. A forgotten Lambda shows up as a missing env var at run time, not at synth.
- `generateDevEnv` needs at least one `envOf` value to learn the stack and region, and all of them must share one region.
- `envOf(construct)` throws when Lambdas under the construct set one name to different values, and names both. Pass a narrower construct, for example `envOf(auth.node.findChild("Api"))`.
- `envOf` accepts constructs that contain the Lambda, not wrappers that only reference it (for example a function URL); pass the function itself.
- An unresolved region or stack name throws when a value needs a lookup; set `env.region` and `stackName` on the stack.
- `Ref` to `AWS::Partition`, `AWS::Region`, `AWS::AccountId` and `AWS::URLSuffix` is substituted from the stack, and a `Fn::Join` that becomes fully literal is emitted as a static value (e.g. a default event bus ARN).
- A single local process reads one env. If two embedded constructs need the same name for different resources, decide which one wins by spread order, or avoid the need (for example a local synchronous task runner).

## See Also

- [Define a Project Config](./define-a-project-config.md)
- [Getting Started](./getting-started.md)
- [README](../../README.md)
