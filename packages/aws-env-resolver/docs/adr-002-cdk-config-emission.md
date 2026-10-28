# ADR-002: CDK Config Emission

## Status

Accepted

## Context

The resolver needs a mapping from env var to CloudFormation logical-id prefix, plus the stack name, region, and secret id. Writing it by hand works, but it is a second description of wiring the CDK app already declares: the same `environment: { DATA_TABLE_NAME: table.tableName }` that configures a deployed Lambda. A hand-maintained copy drifts from the infrastructure.

At synth time a resource's physical name is an unresolved CloudFormation token. CloudFormation assigns the random suffix at deploy time, so synth can never produce the real names.

## Decision

Provide an optional `@beesolve/aws-env-resolver/cdk` entry point with `generate`, `persist`, and `generateAndPersist`. It walks the construct tree under a given scope, reads each Lambda function's `environment`, and emits a declarative config (the recipe) as `aws-env.config.json`. The resolver then fills in real values from the deployed stack at dev time.

## Rationale

### 1. Emit the recipe, not values

Because physical names are unresolved tokens at synth, the emitter records env var to logical-id prefix, plus stack, region, secret id, and static values. The mapping and the infrastructure cannot drift because the mapping is derived from the actual wiring. A helper that returns real table names during synth is impossible and is deliberately not offered.

### 2. Direct walk instead of an Aspect

`generate` walks `scope.node.findAll()` when the user calls it. An Aspect runs inside the synth prepare phase and is not meant for file I/O, so tying a deterministic file write to it fights the CDK lifecycle. An explicit call in the app entry file is synchronous, simple, and writes exactly when invoked.

### 3. `.json` for generated config, `.ts` for hand-written

Generated config is data. JSON needs no lint or format pass, diffs cleanly, and is safe to regenerate on every synth. Hand-written config stays TypeScript so it is type-checked and can use computed values and transform functions. The rule: generated goes to `.json`, manual goes to `.ts`.

### 4. CDK is an optional peer

`aws-cdk-lib` and `constructs` are optional peer dependencies used only by the `./cdk` entry. The core library and the CLI never import them, so a developer who only resolves env does not install CDK. The pure mapping logic lives in `src/emit.ts` and takes already-extracted data, so it is testable without CDK.

### 5. Declarative transform tags

A function cannot live in JSON. For the common case of a Lambda ARN, the emitter records a small tag (`{ kind: "lambdaArn" }`) that the resolver interprets. This keeps the `.json` form pure data while hand-written `.ts` config can still use functions.

## Consequences

- Env vars injected by third-party constructs that are not visible as plain values on the user's Lambdas are not discovered. They must be passed through the `staticEnv` prop or mapped by hand in a `.ts` config.
- Only `Ref` and `Fn::GetAtt` on `Arn` are understood. Any other intrinsic or attribute throws with a message pointing at `staticEnv` or manual mapping.
- Secrets cannot be discovered by walking. The caller passes the secret id and the env vars sourced from it.
- A single stack is supported: if the walked Lambdas span several stacks, `generate` throws and the caller must pass a narrower scope. The stack must have a resolved region and an explicit stack name. At most one secret id is allowed.
- An env var listed in `secrets` or passed in `staticEnv` is dropped from the walked result. The `namespace` prop is not written into the JSON.

## Alternatives Considered

### Aspect

Visit nodes through `Aspects.of(app).add(...)`. Rejected for the lifecycle reason above: file output inside the prepare phase is awkward and hard to control.

### CfnOutput-based resolution

Export every needed name as a stack output and read the outputs at dev time. Rejected because it requires declaring an output per env var, which is another hand-maintained list, and adds output limits and cross-stack naming concerns.

### Resolve at synth

Produce real physical names during synth. Impossible: they are tokens until deploy.

## References

- [AWS CDK tokens](https://docs.aws.amazon.com/cdk/v2/guide/tokens.html)
