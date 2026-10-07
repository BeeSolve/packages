# How to: Get started with lambda-keep-active

> Full source: https://github.com/BeeSolve/packages/tree/main/packages/lambda-keep-active

## Prerequisites

- A CDK app (`aws-cdk-lib` + `constructs`)
- One or more Lambda functions you want to keep active

## Background

Lambda functions become `inactive` after roughly 14 days of idleness, and waking
one can take up to 90 seconds. This construct invokes registered functions every
3 days so they stay active.

## Steps

### 1. Install

```sh
bun add @beesolve/lambda-keep-active
```

```sh
npm install @beesolve/lambda-keep-active
```

### 2. Register functions in CDK

```ts
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";

const warmer = new LambdaKeepActive(this, "KeepActive");

const handler = new NodejsFunction(this, "Handler", {/* your props */});

warmer.keepActive(handler);
```

### 3. Short-circuit keep-alive invocations in your handler

Wrap a Node.js handler with `keptActive` so warm-up invocations return early
instead of running your logic.

```ts
import { keptActive } from "@beesolve/lambda-keep-active/runtime";

export const handler = keptActive(async () => {
  // your handler code
});
```

For a Bun fetch-style handler, use `keptActiveFetch`.

```ts
import { keptActiveFetch } from "@beesolve/lambda-keep-active/runtime";

export default {
  fetch: keptActiveFetch(async (request: Request): Promise<Response> => {
    return new Response();
  }),
};
```

## Common Pitfalls

- Without the `keptActive` / `keptActiveFetch` wrapper, keep-alive invocations run your full handler and may cause unwanted side effects.
- Match the wrapper to the runtime: `keptActive` for Node.js handlers, `keptActiveFetch` for Bun fetch handlers.

## See Also

- [README](../../README.md) — construct and runtime wrapper reference
