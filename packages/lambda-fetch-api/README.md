# @beesolve/lambda-fetch-api

[![npm version](https://img.shields.io/npm/v/@beesolve/lambda-fetch-api)](https://www.npmjs.com/package/@beesolve/lambda-fetch-api)
[![license](https://img.shields.io/npm/l/@beesolve/lambda-fetch-api)](./LICENSE)

Run standard [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) handlers inside AWS Lambda. Converts API Gateway v1 (REST) and v2 (HTTP) events into `Request` objects and converts `Response` objects back into Lambda proxy integration results.

## Installation

```bash
npm install @beesolve/lambda-fetch-api
```

## Usage

### Basic handlers

Wrap any `(request: Request) => Promise<Response>` function:

```ts
import { asHttpV2Handler } from "@beesolve/lambda-fetch-api";

export const handler = asHttpV2Handler(async (request) => {
  const body = await request.json();
  return Response.json({ ok: true, received: body }, { status: 201 });
});
```

```ts
import { asHttpV1Handler } from "@beesolve/lambda-fetch-api";

export const handler = asHttpV1Handler(async (request) => {
  const url = new URL(request.url);
  return Response.json({ path: url.pathname });
});
```

### Response streaming

```ts
import { asResponseStreamHandler } from "@beesolve/lambda-fetch-api";

export const handler = asResponseStreamHandler(async () => {
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue("chunk one\n");
      controller.enqueue("chunk two\n");
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain" } });
});
```

### Accessing the AWS event and context

The original event and context are stored per-invocation via [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage). Call the getters from anywhere inside your handler — no need to thread parameters:

```ts
import {
  asHttpV2Handler,
  getAwsEvent,
  getAwsV2Event,
  getAwsContext,
} from "@beesolve/lambda-fetch-api";

export const handler = asHttpV2Handler(async (request) => {
  const event = getAwsV2Event(); // APIGatewayProxyEventV2
  const context = getAwsContext(); // Context

  console.log(event.requestContext.requestId);
  console.log(context.getRemainingTimeInMillis());

  return new Response("ok");
});
```

| Getter            | Returns                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `getAwsEvent()`   | `APIGatewayProxyEvent \| APIGatewayProxyEventV2` — auto-detected |
| `getAwsV1Event()` | `APIGatewayProxyEvent` — throws if event is v2                   |
| `getAwsV2Event()` | `APIGatewayProxyEventV2` — throws if event is v1                 |
| `getAwsContext()` | `Context`                                                        |

All getters throw `NotInHandlerContextError` if called outside of a handler invocation.

### Authorizer handlers

For routes protected by a Lambda authorizer, use the authorizer-aware handler variants. The incoming event type is correctly narrowed to include the authorizer payload:

**HTTP API v2 — Lambda authorizer:**

```ts
import { asLambdaAuthorizedHttpV2Handler } from "@beesolve/lambda-fetch-api";

export const handler = asLambdaAuthorizedHttpV2Handler(async (request) => {
  return Response.json({ ok: true });
});
// event: APIGatewayProxyEventV2WithLambdaAuthorizer<unknown>
```

**REST API v1 — custom authorizer:**

```ts
import { asCustomAuthorizedHttpV1Handler } from "@beesolve/lambda-fetch-api";

export const handler = asCustomAuthorizedHttpV1Handler(async (request) => {
  return Response.json({ ok: true });
});
// event: APIGatewayProxyWithLambdaAuthorizerEvent<unknown>
```

### Reading the authorizer payload

Use `getAwsLambdaAuthorizerContext` (v2) or `getAwsCustomAuthorizerContext` (v1) to read the authorizer payload. Pass a [Standard Schema](https://standardschema.dev/)-compatible schema to validate and type the result — works with valibot, Zod, ArkType, and any other Standard Schema library.

```ts
import * as v from "valibot";
import {
  asLambdaAuthorizedHttpV2Handler,
  getAwsLambdaAuthorizerContext,
} from "@beesolve/lambda-fetch-api";

const AuthSchema = v.object({
  userId: v.string(),
  role: v.picklist(["admin", "editor", "viewer"]),
});

export const handler = asLambdaAuthorizedHttpV2Handler(async (request) => {
  const auth = await getAwsLambdaAuthorizerContext(AuthSchema);
  // auth: { userId: string; role: "admin" | "editor" | "viewer" }

  if (auth.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  return Response.json({ user: auth.userId });
});
```

Without a schema, the getter returns `unknown`:

```ts
const raw = getAwsLambdaAuthorizerContext(); // unknown
```

`AuthorizerContextValidationError` is thrown when the schema rejects the payload.

### Type guards

Use these to narrow a union event type at runtime:

```ts
import { isAPIGatewayProxyEvent, isAPIGatewayProxyEventV2 } from "@beesolve/lambda-fetch-api";

const event = getAwsEvent();

if (isAPIGatewayProxyEventV2(event)) {
  console.log(event.rawPath); // APIGatewayProxyEventV2
} else {
  console.log(event.path); // APIGatewayProxyEvent
}
```

## Testing

Use `runWithAwsContext` to run code inside a fake invocation context — the same mechanism the handlers use internally:

```ts
import { runWithAwsContext, getAwsV2Event, getAwsContext } from "@beesolve/lambda-fetch-api";

test("reads event inside context", async () => {
  const event = makeV2Event();
  const context = makeContext();

  await runWithAwsContext(event, context, async () => {
    expect(getAwsV2Event()).toBe(event);
    expect(getAwsContext().awsRequestId).toBe("req-123");
  });
});
```

Testing authorizer context works the same way — shape the event with the authorizer payload:

```ts
const event = {
  ...makeV2Event(),
  requestContext: {
    ...makeV2Event().requestContext,
    authorizer: { lambda: { userId: "u1", role: "admin" } },
  },
};

await runWithAwsContext(event, makeContext(), async () => {
  const auth = await getAwsLambdaAuthorizerContext(AuthSchema);
  expect(auth.userId).toBe("u1");
});
```

## Error classes

| Class                              | Thrown when                                        |
| ---------------------------------- | -------------------------------------------------- |
| `NotInHandlerContextError`         | A getter is called outside of a handler invocation |
| `AuthorizerContextValidationError` | The Standard Schema rejects the authorizer payload |

## Response utilities

`awsRequest`, `awsResponseHeaders`, and `awsResponseBody` are exported for advanced use cases where you need to drive the request/response conversion manually.

## License

MIT
