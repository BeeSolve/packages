# How to: Emit the config from a CDK app

## Prerequisites

- A CDK app (`aws-cdk-lib` and `constructs`) whose Lambdas receive the env vars you want locally
- `@beesolve/aws-env-resolver` installed, see [Getting Started](./getting-started.md)
- A stack with an explicit `env.region` and `stackName`

## Steps

### 1. Mark what the local process needs

`traceEnv` marks a Lambda, or any construct that contains Lambdas (an auth gateway, a SvelteKit site, a whole stack). Every Lambda function under a marked construct is traced; nothing has to be passed through stacks. Call it in `app.ts` with the constructs you already hold, or next to where a handler is created.

```ts
import { traceEnv } from "@beesolve/aws-env-resolver/cdk";

const { api, auth, payments } = new ApiStack(app, "ApiStack", {
  stackName: "example-api",
  env: { region: "eu-central-1" },
});

traceEnv(api);
traceEnv(auth);
traceEnv(payments);
```

Lambdas you do not mark are ignored, so unrelated functions cannot cause conflicting env vars. `traceEnv(app)` traces everything. Marking a construct that contains no Lambda throws.

### 2. Emit from the app entry file

`generateAndPersist` finds the marked constructs under `scope`, reads their Lambdas' `environment`, and writes `aws-env.config.<stage>.json` (or `aws-env.config.json` without a stage). Stages almost always differ in stack names, account, and static values, so emit one file per stage. Guard it with a flag so it runs only when asked.

```ts
import { generateAndPersist } from "@beesolve/aws-env-resolver/cdk";

if (process.env.EMIT_ENV_CONFIG != null) {
  generateAndPersist({
    projectName: "example-app",
    stage: "dev", // writes aws-env.config.dev.json; run the CLI with --stage dev
    scope: app,
    profile: "example-profile",
    secrets: [{ secretId: "example/secrets", envVars: ["API_KEY", "SIGNING_KEY"] }],
    staticEnv: { BASE_URI: "https://example.test:3000" },
    // path: "custom.json", // optional, overrides the stage-derived default
  });
}
```

Run it with `EMIT_ENV_CONFIG=1 bunx cdk synth`.

- `generate(props)` returns the config without any I/O, for inspecting or merging.
- `persist(config, { path })` writes a config as JSON.
- `generateAndPersist({ ...props, stage, path })` is `persist(generate(props), { path: path ?? defaultConfigPath(stage) })`.

### 3. Split runtimes with targets (optional)

A target is a named group of traced constructs, resolved as its own environment. Use it when you run several local processes that need different env, for example a SvelteKit dev server and a queue-consumer script.

```ts
traceEnv(site, { target: "web" });
traceEnv(auth, { target: "web" });
traceEnv(digestHandler, { target: "worker" });
```

- Without `target`, constructs belong to the `default` target. Single-runtime projects never need the concept.
- A construct can be in several targets: `target: ["web", "worker"]`.
- Conflicts are checked inside each target, so the same env var can point at different resources in different targets. Processes that share one `process.env` (like one Bun dev server running api, payments, and auth) must share one target.
- The file holds `{ projectKey, targets }`. Run `aws-env-resolver --stage dev --target web -- bun dev`. With exactly one target `--target` is optional; with several it is required.
- `secrets` and `staticEnv` apply to every target.

### 4. Use the result

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

- Nothing is emitted for a Lambda you did not trace. If nothing under `scope` is marked, `generate` throws. A forgotten Lambda shows up as a missing env var at run time, not at synth.
- Within a target, stacks whose traced Lambdas have no environment (such as Lambda@Edge) are skipped. If the included stacks span several regions, `generate` throws; trace only the constructs in one region or give the others another target.
- `scope` accepts an `App`, `Stage`, `Stack`, or an array of them, e.g. `scope: [apiStack, commonStack]`. It only limits where markers are searched.
- `Ref` to `AWS::Partition`, `AWS::Region`, `AWS::AccountId` and `AWS::URLSuffix` is substituted from the stack, and a `Fn::Join` that becomes fully literal is emitted as a static value (e.g. a default event bus ARN).
- An unresolved region or stack name throws; set `env.region` and `stackName` on the stack.
- The same env var with different values on different Lambdas of one target throws as a conflict, naming the target. Split the Lambdas into targets, or pass the value through `staticEnv`.
- `traceEnv` accepts constructs that contain the Lambda, not wrappers that only reference it (for example a function URL); trace the function itself.

## See Also

- [Define a Project Config](./define-a-project-config.md)
- [Getting Started](./getting-started.md)
- [README](../../README.md)
