# How to: Get started with lambda-fetch-api

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailAuthorizer

Write AWS Lambda handlers as standard Fetch API functions - `(request: Request) => Promise<Response>` - and let this package convert API Gateway events into `Request` objects and `Response` objects back into Lambda proxy results.

## Prerequisites

- Node.js >= 24 or Bun >= 1.0
- An AWS Lambda function fronted by API Gateway (HTTP API v2 or REST API v1)
- A CDK project if you want to follow the wiring step

## Steps

### 1. Install

```sh
bun add @beesolve/lambda-fetch-api
```

Or with npm:

```sh
npm install @beesolve/lambda-fetch-api
```

### 2. Write a handler

Wrap a Fetch function with the adapter that matches your API Gateway version. For HTTP API v2:

```ts
import { asHttpV2Handler } from "@beesolve/lambda-fetch-api";

export const handler = asHttpV2Handler(async (request) => {
  const body = await request.json();
  return Response.json({ ok: true, received: body }, { status: 201 });
});
```

For REST API v1, use `asHttpV1Handler` with the same handler shape. The exported function (`handler`) is what you point the Lambda runtime at.

### 3. Wire the Lambda in CDK

Point the Lambda runtime handler at the exported `handler` and route API Gateway traffic to it. Using `@beesolve/cdk-constructs`:

```ts
import { NodejsFunction } from "@beesolve/cdk-constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";

const fn = new NodejsFunction(this, "ApiFn", {
  entry: "src/handler.ts",
  handler: "handler",
});

const api = new HttpApi(this, "Api");
api.addRoutes({
  path: "/{proxy+}",
  methods: [HttpMethod.ANY],
  integration: new HttpLambdaIntegration("ApiIntegration", fn),
});
```

### 4. Access the AWS event and context

The original event and context are stored per-invocation via `AsyncLocalStorage`, so any code in the call stack can read them without threading parameters:

```ts
import { asHttpV2Handler, getAwsV2Event, getAwsContext } from "@beesolve/lambda-fetch-api";

export const handler = asHttpV2Handler(async () => {
  const event = getAwsV2Event();
  const context = getAwsContext();
  return Response.json({
    requestId: event.requestContext.requestId,
    remainingMs: context.getRemainingTimeInMillis(),
  });
});
```

Use `getAwsEvent()` for the auto-detected union, `getAwsV1Event()` / `getAwsV2Event()` to assert a specific version, and `getAwsContext()` for the Lambda context.

## Common Pitfalls

- Calling `getAwsEvent()`, `getAwsV2Event()`, `getAwsContext()`, or any `getAws*` getter outside of a handler invocation throws `NotInHandlerContextError`. These only resolve inside the async call chain started by the handler. In tests, wrap your code in `runWithAwsContext(event, context, fn)`.
- `getAwsV1Event()` throws if the current event is a v2 event (and vice versa). Use `getAwsEvent()` with the `isAPIGatewayProxyEventV2` type guard when the version is not known ahead of time.
- Match the adapter to the API Gateway version. An HTTP API v2 route needs `asHttpV2Handler`; a REST API v1 route needs `asHttpV1Handler`.

## See Also

- [SvelteKit integration](./sveltekit-integration.md)
- [authEmailAuthorizer sample](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailAuthorizer)
- [authCookieFunction sample](https://github.com/BeeSolve/packages/tree/main/packages/samples/authCookieFunction)
