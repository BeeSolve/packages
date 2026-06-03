# @beesolve/lambda-fetch-api

## 1.0.0

### Major Changes

- 0361bea: Replace header-based event/context propagation with AsyncLocalStorage.

  **New API:**
  - `getAwsEvent()` — returns the current invocation's event (v1 or v2)
  - `getAwsV1Event()` — returns the event typed as `APIGatewayProxyEvent`, throws if it's a v2 event
  - `getAwsV2Event()` — returns the event typed as `APIGatewayProxyEventV2`, throws if it's a v1 event
  - `getAwsContext()` — returns the original `Context` object (no serialization; `getRemainingTimeInMillis()` works natively)
  - `runWithAwsContext(event, context, fn)` — runs `fn` inside a store populated with the given event and context; use this in tests
  - `NotInHandlerContextError` — thrown when a getter is called outside of a handler invocation

  **Removed (breaking):**
  - `toAwsEvent(request)`, `toAwsV1Event(request)`, `toAwsV2Event(request)`, `toAwsContext(request)` → use `getAws*()` instead
  - `withAwsEvent(request, event)`, `withAwsContext(request, context)` → use `runWithAwsContext(event, context, fn)` in tests
  - `MissingAwsEventHeaderError`, `MissingAwsContextHeaderError`, `InvalidAwsEventHeaderError`, `InvalidAwsContextHeaderError` → replaced by `NotInHandlerContextError`
  - `context` parameter on `awsRequest()` — it is no longer needed

  `valibot` has been removed as a runtime dependency.

### Minor Changes

- e62252d: Add authorizer handler variants and Standard Schema-compatible payload getters.

  **New handler variants:**
  - `asLambdaAuthorizedHttpV2Handler<TAuth>(fetch)` — for HTTP API v2 routes protected by a Lambda authorizer; the Lambda event is typed as `APIGatewayProxyEventV2WithLambdaAuthorizer<TAuth>`
  - `asCustomAuthorizedHttpV1Handler<TAuth>(fetch)` — for REST API v1 routes with a custom/Lambda authorizer; the event is typed as `APIGatewayProxyWithLambdaAuthorizerEvent<TAuth>`

  **New payload getters (callable inside any handler invocation):**
  - `getAwsLambdaAuthorizerContext()` — returns `unknown`; reads `event.requestContext.authorizer.lambda` from the stored v2 event
  - `getAwsLambdaAuthorizerContext(schema)` — validates the payload with any [Standard Schema](https://standardschema.dev/) compatible library (valibot, zod, arktype, …) and returns `Promise<OutputType>`
  - `getAwsCustomAuthorizerContext()` — returns `unknown`; reads `event.requestContext.authorizer` from the stored v1 event
  - `getAwsCustomAuthorizerContext(schema)` — same as above with schema validation

  **New error class:** `AuthorizerContextValidationError` — thrown when the schema rejects the authorizer payload.

  The `StandardSchemaV1` interface is exported from the package so consumers can reference it without an additional dependency.

- feabe20: Add typed event accessors, valibot validation, and local testing helpers.
  - `toAwsV1Event(request)` and `toAwsV2Event(request)` — typed variants of `toAwsEvent` for when the caller knows which API Gateway version they're working with. `toAwsEvent` is kept as the auto-detecting union form.
  - `withAwsEvent(request, event)` and `withAwsContext(request, context)` — helpers for building test requests without going through a full `awsRequest()` call.
  - `InvalidAwsEventHeaderError` and `InvalidAwsContextHeaderError` — thrown when the header is present but fails schema validation.
  - The `aws-event` and `aws-context` headers are now validated with valibot schemas on decode.

### Patch Changes

- a4057f0: Fix `set-cookie` leaking into the flat `headers` object when cookies are present — it now only appears in `multiValueHeaders` (v1) or `cookies` (v2) as API Gateway expects. Export `MissingAwsEventHeaderError` and `MissingAwsContextHeaderError` so callers can catch them specifically.

## 0.1.8

### Patch Changes

- d0a811d: fix test imports to use each package's public index instead of internal `src/` paths
- Updated dependencies [d0a811d]
  - @beesolve/helpers@0.1.6

## 0.1.7

### Patch Changes

- adf27f3: fix content-type regex to correctly anchor `application/json` and related types; previously `application/jsonx` would be incorrectly treated as text
