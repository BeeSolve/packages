# How to: Get started with lambda-function-url-protection

> Full source: https://github.com/BeeSolve/packages/tree/main/packages/lambda-function-url-protection

## Prerequisites

- A CDK app (`aws-cdk-lib` + `constructs`) fronting a Lambda Function URL with CloudFront
- A Lambda handler you want to protect from direct invocation

## Background

A Lambda Function URL created with `authType NONE` is publicly reachable. Putting
CloudFront in front of it only helps if the handler refuses requests that did not
come through the distribution. This package generates a shared secret on the CDK
side and verifies it on the runtime side.

Enforcement is opt-in by environment. The wrappers enforce the token only when
`ORIGIN_TOKEN` is set to a non-empty value (which `protectedFunctionUrlOrigin`
does). When it is unset or empty, requests pass through, so you can wrap a
handler that is also deployed behind a non-token origin (for example an API
Gateway origin) without it rejecting that traffic. Once enforcement is engaged
it is fail-closed: a missing or mismatched `x-origin-token` header is rejected
with a 403.

The protection is independent of the response mode: it works with both streamed
responses (`InvokeMode.RESPONSE_STREAM`) and buffered responses
(`InvokeMode.BUFFERED`). `protectFetch` wraps any fetch-style handler, so it
composes with either a streaming or a buffered adapter, and `protectHandler`
wraps a raw Lambda proxy handler. Pick the pair that matches how your Function
URL is invoked.

## Steps

### 1. Install

```sh
bun add @beesolve/lambda-function-url-protection
```

```sh
npm install @beesolve/lambda-function-url-protection
```

### 2. Wire the protected origin in CDK

Use `protectedFunctionUrlOrigin` inside your `toDefaultOrigin` override. It
generates the secret, injects `ORIGIN_TOKEN` into the handler, creates the
Function URL, and returns a CloudFront origin that sends the `x-origin-token`
header.

The Function URL defaults to `InvokeMode.RESPONSE_STREAM`. For a buffered
handler, pass `invokeMode` explicitly so the Function URL matches the runtime
adapter you choose in the next step.

```ts
import { protectedFunctionUrlOrigin } from "@beesolve/lambda-function-url-protection";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";

protected toDefaultOrigin(): OriginBase {
  // streamed (default)
  return protectedFunctionUrlOrigin({ handler: this.handler });

  // buffered
  // return protectedFunctionUrlOrigin({
  //   handler: this.handler,
  //   invokeMode: InvokeMode.BUFFERED,
  // });
}
```

### 3. Protect a fetch handler (streamed or buffered)

`protectFetch` wraps any `(request: Request) => Promise<Response>` and returns a
function of the same shape, so it composes inside either fetch-style adapter from
`@beesolve/lambda-fetch-api`: `asResponseStreamHandler` for streamed responses or
`asHttpV2Handler` for buffered responses. The token check runs before your fetch
handler, so direct invocations are rejected with a 403.

```ts
import { asResponseStreamHandler } from "@beesolve/lambda-fetch-api";
import { protectFetch } from "@beesolve/lambda-function-url-protection/runtime";

const fetch = protectFetch(async (request) => {
  const url = new URL(request.url);
  return Response.json({ ok: true, path: url.pathname });
});

// streamed (InvokeMode.RESPONSE_STREAM)
export const handler = asResponseStreamHandler(fetch);
```

Swap the adapter to serve buffered responses - the `protectFetch` wrapper is
unchanged:

```ts
import { asHttpV2Handler } from "@beesolve/lambda-fetch-api";

// buffered (InvokeMode.BUFFERED)
export const handler = asHttpV2Handler(fetch);
```

### 4. Protect a Lambda proxy handler alongside keep-active

Compose `protectHandler` inside `keptActive`. The token check runs before your
handler body.

```ts
import { protectHandler } from "@beesolve/lambda-function-url-protection/runtime";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";

export const handler = keptActive(
  protectHandler(async (event, context) => {
    return { statusCode: 200, body: "ok" };
  }),
);
```

`keptActive` comes from `@beesolve/lambda-keep-active`; the point is the
composition order.

## Common Pitfalls

- Keep-active pings invoke the Lambda directly and carry no origin token, so
  `keptActive` must wrap `protectHandler` - the ping check runs first and
  short-circuits. Reversing them makes `protectHandler` reject valid pings with a
  403 before `keptActive` ever sees them.
- `ORIGIN_TOKEN` is set by `protectedFunctionUrlOrigin`. When it is present the
  wrappers enforce the token and reject mismatches with a 403; when it is unset
  or empty they pass requests through (enforcement is opt-in). If a
  token-protected deployment unexpectedly lets traffic through, check that the
  CDK side set `ORIGIN_TOKEN` rather than loosening the handler.

## See Also

- [README](../../README.md) - helper and runtime wrapper reference
