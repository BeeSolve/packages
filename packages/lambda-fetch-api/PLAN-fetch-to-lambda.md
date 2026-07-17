# Plan: Fetch Request/Response → Lambda Event Conversion

## Motivation

The package currently converts AWS Lambda events into Fetch API `Request` objects (inbound) and `Response` objects back into Lambda proxy results (outbound). The reverse direction — converting a Fetch `Request` into a Lambda event and a Lambda result back into a `Response` — is useful for:

- **Testing Lambda handlers locally** without spinning up SAM/localstack
- **Calling Lambda handlers directly** from other code (e.g. in-process integration tests, or routing between handlers)
- **Building adapters** that let you invoke Lambda handler functions from any Fetch-compatible HTTP client or framework

## Proposed Interface

### Core functions

```ts
import {
  requestToHttpV1Event,
  requestToHttpV2Event,
  httpV1ResultToResponse,
  httpV2ResultToResponse,
} from "@beesolve/lambda-fetch-api";
```

#### `requestToHttpV2Event(request: Request, options?: ToEventOptions): APIGatewayProxyEventV2`

Converts a Fetch `Request` into an API Gateway HTTP API (v2) event.

```ts
const request = new Request("https://api.example.com/users?page=2", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Alice" }),
});

const event = await requestToHttpV2Event(request);
// => APIGatewayProxyEventV2 with rawPath, rawQueryString, headers, body, etc.
```

#### `requestToHttpV1Event(request: Request, options?: ToEventOptions): APIGatewayProxyEvent`

Converts a Fetch `Request` into an API Gateway REST API (v1) event.

```ts
const event = await requestToHttpV1Event(request);
// => APIGatewayProxyEvent with path, httpMethod, headers, multiValueHeaders, etc.
```

#### `httpV2ResultToResponse(result: APIGatewayProxyStructuredResultV2): Response`

Converts an API Gateway v2 handler result back into a Fetch `Response`.

```ts
const result = await handler(event, context);
const response = httpV2ResultToResponse(result);
// response.status, response.headers, response.body — all populated
```

#### `httpV1ResultToResponse(result: APIGatewayProxyResult): Response`

Converts an API Gateway v1 handler result back into a Fetch `Response`.

```ts
const result = await handler(event, context);
const response = httpV1ResultToResponse(result);
```

### Options

```ts
interface ToEventOptions {
  /** Route key for v2, resource path for v1. Defaults to "{method} {pathname}". */
  routeKey?: string;
  /** Stage name. Defaults to "$default" (v2) or "prod" (v1). */
  stage?: string;
  /** Account ID for requestContext. Defaults to "123456789012". */
  accountId?: string;
  /** API ID for requestContext. Defaults to "local". */
  apiId?: string;
  /** Source IP. Defaults to "127.0.0.1". */
  sourceIp?: string;
  /** Request ID. Defaults to a random UUID. */
  requestId?: string;
  /** Path parameters extracted from routing. Defaults to null. */
  pathParameters?: Record<string, string> | null;
  /** Stage variables. Defaults to null. */
  stageVariables?: Record<string, string> | null;
}
```

### High-level helper: `invokeFetch`

For the common case of "I have a handler, give me a Fetch-like interface":

```ts
import { invokeFetchV2, invokeFetchV1, makeContext } from "@beesolve/lambda-fetch-api";

// Wraps a v2 handler into a (request: Request) => Promise<Response> function
const fetch = invokeFetchV2(handler);
// or
const fetch = invokeFetchV1(handler);

const response = await fetch(new Request("https://api.example.com/hello"));
```

```ts
function invokeFetchV2(
  handler: (
    event: APIGatewayProxyEventV2,
    context: Context,
  ) => Promise<APIGatewayProxyStructuredResultV2>,
  options?: ToEventOptions & { context?: Context },
): (request: Request) => Promise<Response>;

function invokeFetchV1(
  handler: (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>,
  options?: ToEventOptions & { context?: Context },
): (request: Request) => Promise<Response>;
```

### `makeContext` helper

A test utility that creates a minimal `Context` object:

```ts
import { makeContext } from "@beesolve/lambda-fetch-api";

const context = makeContext(); // sensible defaults
const context = makeContext({ functionName: "my-fn", awsRequestId: "abc" });
```

## Implementation Details

### File structure

```
src/
  fetch-to-event.ts    — requestToHttpV1Event, requestToHttpV2Event
  event-to-response.ts — httpV1ResultToResponse, httpV2ResultToResponse
  invoke.ts            — invokeFetchV1, invokeFetchV2
  context.ts           — makeContext
tests/
  fetch-to-event.test.ts
  event-to-response.test.ts
  invoke.test.ts
```

### `requestToHttpV2Event` logic

1. Parse the URL for `rawPath`, `rawQueryString`, `domainName`, `domainPrefix`
2. Extract headers as flat `Record<string, string>`; split `cookie` header into `cookies` array
3. Read body — if binary content-type, base64-encode and set `isBase64Encoded: true`
4. Build `requestContext` with `http.method`, `http.path`, `http.protocol`, `http.sourceIp`, timestamps, IDs
5. Derive `routeKey` from method + pathname (or use option)

### `requestToHttpV1Event` logic

1. Parse URL for `path`, `queryStringParameters`, `multiValueQueryStringParameters`
2. Build `headers` and `multiValueHeaders` (split on comma where appropriate)
3. Body handling same as v2
4. Build `requestContext` with `httpMethod`, `path`, `resourcePath`, `identity` block
5. Set `resource` from option or default to path

### `httpV2ResultToResponse` logic

1. Read `statusCode`
2. Merge `headers` + `cookies` (set as `set-cookie` headers)
3. Decode body — if `isBase64Encoded`, decode from base64; otherwise use as string

### `httpV1ResultToResponse` logic

1. Read `statusCode`
2. Merge `headers` + `multiValueHeaders` (particularly `set-cookie`)
3. Decode body same as v2

### Body handling (Request → Event)

The `Request` body needs to be consumed (`await request.arrayBuffer()`). Since this is async, `requestToHttpV1Event` and `requestToHttpV2Event` will return `Promise<Event>`.

If the body content-type is binary (not text/json/xml), base64-encode it and set `isBase64Encoded: true`. Reuse the existing `isTextType` helper from `src/util.ts` (export it).

## Naming considerations

- `requestToHttpV2Event` / `requestToHttpV1Event` — explicit direction, matches existing `asHttpV2Handler` / `asHttpV1Handler` naming
- `httpV2ResultToResponse` / `httpV1ResultToResponse` — symmetric naming
- `invokeFetchV2` / `invokeFetchV1` — combines both directions into a single callable

## Scope

- No new dependencies needed
- Reuses `isTextType` from existing `src/util.ts`
- `makeContext` is a straightforward factory with defaults
- All new code is pure functions, no side effects

## Testing approach

- Unit tests for each conversion function with various payloads (text, binary, query params, cookies, multi-value headers)
- Round-trip tests: `Request → event → awsRequest → Request` should preserve method, url, headers, body
- Round-trip tests: `Response → awsResponseBody/awsResponseHeaders → result → httpV2ResultToResponse → Response` should preserve status, headers, body
- Integration test: `invokeFetchV2(asHttpV2Handler(fetch))` should be equivalent to calling `fetch` directly
