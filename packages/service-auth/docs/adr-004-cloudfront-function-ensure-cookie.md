# ADR-004: CloudFront Function for SSR + Cached Lambda Authorizer

## Status

Accepted

## Date

2026-07-16

## Context

ADR-002 established that SSR apps cannot use the cached Lambda authorizer pattern because HTTP API Gateway returns 401 when `identitySource` is configured and the cookie header is missing. Two patterns were provided: authorizer without caching (Pattern 2 "disabled") and in-process session resolution (Pattern 3).

However, Pattern 2 without caching means the authorizer Lambda is invoked on every request — no cost savings from caching. Pattern 3 grants the handler Lambda direct DynamoDB access, which some teams want to avoid for separation-of-concerns reasons.

A third option exists: inject a placeholder cookie at the CDN edge so that API Gateway's `identitySource` requirement is always satisfied.

## Decision

Provide `auth.ensureCookieFunction` — a CloudFront Function that inspects incoming viewer requests and injects `__Host-SID=anonym` when the session cookie is absent. This ensures:

1. API Gateway always receives a cookie header, satisfying `identitySource: ["$request.header.Cookie"]`.
2. The authorizer is always invoked (never short-circuited by a 401).
3. Authorizer caching works correctly — `__Host-SID=anonym` caches to "session invalid" context.
4. The SSR app receives authorizer context on every request and handles redirects.

The user attaches the function to their CloudFront distribution's default behavior as a viewer-request association. The construct exposes it but does not auto-attach it (the distribution is owned by the user's stack).

The placeholder value `anonym` was chosen because:

- It's clearly not a valid session ID (session IDs are base64url-encoded UUIDs).
- It's short and readable in logs.
- The authorizer treats it as "session not found" → returns `{ type: "invalid" }`.

## Consequences

### Positive

- SSR apps can use `addAuthorizedEndpoint` with the full authorizer + caching pattern — the default `"balanced"` (45s) cache works as-is.
- Single CloudFront Function (sub-millisecond, cheap) instead of disabling caching entirely.
- No changes to the authorizer code — it already handles invalid/missing sessions gracefully.
- Clean separation preserved — the handler Lambda does not need DynamoDB access to the sessions table.

### Negative

- Users must wire `auth.ensureCookieFunction` to their CloudFront behavior themselves — one extra line of CDK configuration.
- A synthetic cookie value (`anonym`) flows through the system — could confuse debugging if not documented.
- 2 Lambda invocations per uncached request (CloudFront Function + authorizer + handler, though CF Functions are not Lambdas).
- Users must add `@beesolve/lambda-fetch-api` to `ssr.external` in `vite.config.ts` so that Vite doesn't inline the module. Without this, esbuild produces separate `AsyncLocalStorage` instances for the handler and hooks, breaking `getSessionContext()`.

## Alternatives Considered

### Auto-attach the function inside the construct

Rejected. The construct does not own the CloudFront distribution — it's created by `kit-on-lambda`'s `SvelteKit` construct or the user's own stack. Exposing the function as a property keeps the API composable.

### Use Lambda@Edge instead of CloudFront Function

Rejected. Lambda@Edge has higher latency (~5ms vs <1ms), costs more, and requires us-east-1 deployment. CloudFront Functions are sufficient for this simple header manipulation.

### Inject a different cookie name (not `__Host-SID`)

Rejected. The `identitySource` is `$request.header.Cookie` — it caches on the entire Cookie header value. Using the same cookie name as the real session cookie ensures the cache key naturally differentiates between anonymous and authenticated requests.
