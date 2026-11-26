# Lambda Keep Active

A CDK construct that periodically invokes your Lambda functions to prevent them from transitioning to the `inactive` state.

> Lambda functions become inactive after approximately 14 days of idleness. Waking an inactive function can take [up to 90 seconds](https://aws.amazon.com/blogs/compute/announcing-improved-vpc-networking-for-aws-lambda-functions/). This construct invokes your functions every 3 days to keep them active.

> [!IMPORTANT]  
> Starting from v2 the package does not use [`projen`](https://projen.io) anymore.

## Installation

```bash
npm i @beesolve/lambda-keep-active
```

## Quick Start

```ts
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";

const warmer = new LambdaKeepActive(this, "KeepAliveLambda");

const handler = new NodejsFunction(this, "Handler", {/** your props */});

warmer.keepActive(handler);
```

## Handler Wrappers

Use the `keptActive` wrapper in your Node.js Lambda handlers to short-circuit keep-alive invocations:

```ts
import { keptActive } from "@beesolve/lambda-keep-active/runtime";

export const handler = keptActive(async () => {
  // your handler code
});
```

For the [Bun Lambda runtime](https://github.com/BeeSolve/lambda-bun-runtime) v4, which passes raw Lambda events to your handler, wrap the exported handler itself. Use `keptActiveStreaming` for streaming handlers such as the result of `asResponseStreamHandler`. It calls the handler with `(event, responseStream, context)` and keeps the streaming marker of the wrapped function, so the runtime still streams:

```ts
import { asResponseStreamHandler } from "@beesolve/lambda-fetch-api";
import { keptActiveStreaming } from "@beesolve/lambda-keep-active/runtime";

export const handler = keptActiveStreaming(
  asResponseStreamHandler(async (request: Request): Promise<Response> => {
    return new Response("ok");
  }),
);
```

`keptActiveFetch` only applies to runtimes that deliver a Fetch `Request` with the URL `https://lambda/` for non-HTTP events. The Bun runtime v4 does not, so use `keptActive` or `keptActiveStreaming` there:

```ts
import { keptActiveFetch } from "@beesolve/lambda-keep-active/runtime";

export default {
  fetch: keptActiveFetch(async (request: Request): Promise<Response> => {
    // your handler code
    return new Response();
  }),
};
```
