# How to: Get Started with @beesolve/cdk-constructs

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi

## Prerequisites

- An AWS CDK v2 app (`aws-cdk-lib` + `constructs`)
- Node.js 24+ for the Lambda runtime targeted by `Nodejs24Function`
- Git available in the working directory if you use `tagFunctionsWithRevision`

## Available Constructs

| Export                            | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `Nodejs24Function`                | Node.js 24 Lambda with ARM64, esbuild ESM bundling, JSON logging    |
| `tagFunctionsWithRevision`        | Tags every `Function` in a stack with the current git commit        |
| `SqsWithDlq`                      | SQS queue + dead-letter queue pair with SSL and encryption defaults |
| `StaticWebsite`                   | CloudFront + S3 static site with security headers and optional auth |
| `CloudFrontAccessLoggingSettings` | S3 access-log bucket with optional Glue + Athena querying           |
| `esmBuild` / `esmBuildSync`       | Low-level esbuild wrapper producing Node.js 24 ESM output           |

## Steps

### 1. Install

```sh
bun add @beesolve/cdk-constructs
```

`aws-cdk-lib`, `constructs`, and `typescript` are peer dependencies - install them if your app does not already depend on them. npm works too (`npm i @beesolve/cdk-constructs`).

### 2. Deploy a Lambda with `Nodejs24Function`

Point `entry` at a TypeScript file that exports a `handler`. The construct bundles it with esbuild at synth time - no separate build step.

```ts
import { Nodejs24Function } from "@beesolve/cdk-constructs";

const api = new Nodejs24Function(this, "Api", {
  entry: `${__dirname}/handlers/api.ts`,
});
```

### 3. Use prebuilt code (skip bundling)

When `entry` ends with `/` or `.zip`, bundling is skipped and `handler` is required.

```ts
new Nodejs24Function(this, "Api", {
  entry: "dist/api.zip",
  handler: "api.handler",
});
```

### 4. Tag functions with the git revision

```ts
import { tagFunctionsWithRevision } from "@beesolve/cdk-constructs";

tagFunctionsWithRevision(this, {});
```

## Common Pitfalls

- `Nodejs24Function` throws if you pass prebuilt code (`entry` ending in `/` or `.zip`) without a `handler` in `filename.functionName` form.
- `tagFunctionsWithRevision` throws `NotAGitRepositoryError` when run outside a git repo. Pass `{ enforceGit: false }` to fall back to a placeholder revision.
- The runtime is pinned to Node.js 24 and the architecture to ARM64 - build native dependencies accordingly.

## See Also

- [Set up a static website](./static-website.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi)
