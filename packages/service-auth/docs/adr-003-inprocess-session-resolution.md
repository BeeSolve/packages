# ADR-003: In-Process Session Resolution for SvelteKit

## Status

Accepted

## Date

2026-07-16

## Context

For SvelteKit SSR applications on Lambda, we need a way to resolve sessions without relying on the HTTP API Gateway Lambda authorizer (see ADR-002).

The authorizer-without-caching approach (ADR-002, pattern 1) works but requires 2 Lambda invocations per request — one for the authorizer and one for the handler. For most SSR applications, this is unnecessary overhead.

The `SessionAuthorizer` class already exists in the package (`sessionAuthorizer.ts`) and can resolve sessions by reading the cookie header and querying DynamoDB. It handles:

- Missing/invalid cookies → returns `{ type: "invalid" }`
- Expired sessions → returns `{ type: "expired" }`
- Valid sessions → returns `{ type: "valid" }` with session rotation

## Decision

Provide `createInProcessSessionHandle()` in `@beesolve/auth-service/sveltekit` that:

1. Instantiates `SessionAuthorizer` (reads DynamoDB config from env vars)
2. On each request, reads the cookie header and calls `authorize()`
3. Populates `event.locals.session` with the result
4. Sets `Set-Cookie` headers on the response (session rotation/clearing)

A corresponding CDK helper `auth.grantSessionAccess(handler)` grants the SvelteKit handler Lambda:

- DynamoDB read/write permissions on the sessions table
- Environment variables for table name, index name, max age, and refresh drift

This becomes the recommended pattern for SvelteKit SSR applications.

## Consequences

### Positive

- Single Lambda invocation per request — lowest possible latency for session resolution.
- Session rotation (Set-Cookie headers) is handled by the hook, same as the authorizer-based pattern — no behavioral difference from the consumer's perspective.
- Reuses the existing `SessionAuthorizer` class — no new session validation logic to maintain.
- Same trust boundary as `grantSdkAccess` — no privilege escalation.

### Negative

- The SvelteKit handler Lambda has direct DynamoDB access to the sessions table — broader IAM permissions than the authorizer-only pattern.
- No caching of session lookups — each request hits DynamoDB (single-digit ms, acceptable for SSR page loads).
- Couples the SvelteKit app to `@beesolve/auth-service` internals (env var names, DynamoDB schema) — changes to the sessions table require updating the handle hook.

## Alternatives Considered

### In-memory caching of session lookups

Rejected. Lambda scales horizontally — each instance has isolated memory, no sharing. Session rotation changes the SID, invalidating cache entries unpredictably. DynamoDB single-item GetItem latency is already single-digit milliseconds. Cache invalidation complexity outweighs the marginal latency improvement.

### Invoking the SDK handler Lambda

Rejected. The `sdkHandler` Lambda can validate sessions, but invoking another Lambda from the request path adds more latency than a direct DynamoDB read and introduces cold start risk on the SDK handler.

### Authorizer without caching (ADR-002, pattern 1)

Viable but not recommended as the default. 2 Lambda invocations per request is unnecessary overhead when the handler can resolve the session directly with a single DynamoDB read. Useful when strict separation of concerns between auth and application logic is required.
