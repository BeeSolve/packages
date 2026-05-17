---
"@beesolve/lambda-fetch-api": major
---

Replace header-based event/context propagation with AsyncLocalStorage.

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
