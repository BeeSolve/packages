# ADR-002: Use AsyncLocalStorage for AWS Event/Context Propagation

**Status:** Accepted  
**Date:** 2026-05-17  
**Package:** `@beesolve/lambda-fetch-api`

---

## Context

The package bridges AWS Lambda handlers with the standard Fetch API. When a Lambda invocation arrives, the handler converts the AWS event and context into a standard `Request` and passes it to a user-supplied fetch function. Sometimes the fetch function — or code it calls — needs access to the original AWS event or context (e.g. to read authorizer claims, the AWS request ID, or remaining time).

The original solution serialized the event and context into two custom request headers (`aws-event`, `aws-context`) as base64url-encoded JSON:

```
aws-event:   <base64url(JSON.stringify(event))>
aws-context: <base64url(JSON.stringify({ ...context, serializedAtTimeInMillis, remainingTimeInMillis }))>
```

Consumers called `toAwsEvent(request)` / `toAwsContext(request)` to deserialize them, threading `request` through to any call site that needed the data.

**Problems with this approach:**

1. **Serialization cost** — every invocation pays for JSON stringify + base64url encode on the way in, and base64url decode + JSON parse + valibot validation on the way out.
2. **Header pollution** — the `aws-event` and `aws-context` headers appear in the `Request` object seen by user handlers, leaking internal plumbing.
3. **Large events** — the full event payload is embedded in the request headers, which can be significant for payloads with large body content.
4. **Timestamp hack** — `Context.getRemainingTimeInMillis()` is a function, not a value. The header approach had to snapshot `remainingTimeInMillis` at serialization time and store a `serializedAtTimeInMillis` timestamp to approximate remaining time on decode.
5. **Threaded argument** — `request` had to be passed to every call site that needed event or context data, even when logically unrelated to the HTTP request.

---

## Decision

Replace the header-based approach with [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage) from Node.js `async_hooks` (available in Bun since v1).

Each handler wraps the user's fetch call in `storage.run({ event, context }, fn)`. Because Lambda processes one invocation per async call chain at a time, the store is naturally scoped to the invocation. No serialization, no headers, no threading.

**New API:**

```ts
// Zero-argument getters — callable from anywhere inside a handler invocation
getAwsEvent(): APIGatewayProxyEvent | APIGatewayProxyEventV2
getAwsV1Event(): APIGatewayProxyEvent
getAwsV2Event(): APIGatewayProxyEventV2
getAwsContext(): Context

// Test helper — runs fn with event and context in the store
runWithAwsContext(event, context, fn): Promise<T>
```

All `to*`/`with*` request-argument functions and header-related error classes are removed.

---

## Consequences

**Positive:**

- No serialization/deserialization overhead per invocation.
- `getRemainingTimeInMillis()` works natively — the original `Context` object is stored directly.
- Request headers are clean; no internal `aws-*` headers visible to user code.
- Simpler consumer API — no need to thread `request` to access event or context.
- `valibot` can be removed as a runtime dependency of this package.

**Negative / Breaking:**

- **Breaking API change** — `toAwsEvent(request)`, `toAwsV1Event(request)`, `toAwsV2Event(request)`, `toAwsContext(request)`, `withAwsEvent`, `withAwsContext`, and the four header error classes are removed. Consumers must migrate to the new getters.
- `awsRequest()` drops its `context` parameter (it no longer embeds headers).
- Calling `getAws*()` outside of a handler invocation throws `NotInHandlerContextError` at runtime — there is no compile-time protection.
- Requires Node.js ≥ 12.17 or Bun ≥ 1.0 (both already required by the package).
