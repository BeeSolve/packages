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

For the Bun runtime v4 (`@beesolve/lambda-bun-runtime`), wrap the exported handler the same way. For streaming handlers use `keptActiveStreaming`. It expects `(event, responseStream, context)` and keeps the streaming marker of the wrapped function:

```ts
import { asResponseStreamHandler } from "@beesolve/lambda-fetch-api";
import { keptActiveStreaming } from "@beesolve/lambda-keep-active/runtime";

export const handler = keptActiveStreaming(
  asResponseStreamHandler(async (request: Request): Promise<Response> => {
    return new Response("ok");
  }),
);
```

`keptActiveFetch` is only for runtimes that hand over a Fetch `Request` with the URL `https://lambda/` for non-HTTP events. The Bun runtime v4 passes raw events and does not do that.

## Common Pitfalls

- Without the `keptActive` / `keptActiveStreaming` / `keptActiveFetch` wrapper, keep-alive invocations run your full handler and may cause unwanted side effects.
- Wrap the outermost exported handler. Wrapping only the inner Fetch function does not work on the Bun runtime v4, because `asResponseStreamHandler` and `asHttpV2Handler` build a `Request` from the event before your function runs, and a keep-active ping has no HTTP shape.
- `keptActiveFetch` is for runtimes that deliver Fetch `Request`s with the URL `https://lambda/`, use `keptActive` or `keptActiveStreaming` on the Bun runtime v4.

## See Also

- [README](../../README.md) - construct and runtime wrapper reference
