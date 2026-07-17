# ADR-002: SSR Apps Cannot Use Cached Lambda Authorizer

## Status

Accepted

## Date

2026-07-16

## Context

`@beesolve/auth-service` provides a Lambda authorizer for HTTP API Gateway that validates session cookies and injects session context into downstream Lambda handlers. The authorizer uses `identitySource: ["$request.header.Cookie"]` to enable response caching — API Gateway skips re-invoking the authorizer when the same cookie is seen within the cache TTL.

When deploying SvelteKit SSR applications via `kit-on-lambda`, we discovered a fundamental incompatibility:

**HTTP API Gateway returns 401 before reaching the Lambda when `identitySource` is set and the specified header is missing.** This means a first-time visitor (no cookie) receives a raw 401 from the gateway. The SvelteKit handler is never invoked, so it cannot issue a redirect to `/sign-in`.

This is not a problem for SPAs because:

- SPAs serve static files from S3/CloudFront (no gateway involved for page loads)
- Only API calls (`/api/*`) go through the gateway
- The SPA JavaScript handles 401 responses and redirects client-side

SSR apps need the server to handle every request, including unauthenticated ones, to issue HTTP redirects.

## Decision

SSR applications deployed via `kit-on-lambda` should NOT use the cached Lambda authorizer pattern (with `identitySource`).

Two alternative patterns are provided:

1. **Authorizer without caching** (`authorizerCache: "disabled"`) — removes `identitySource` so the authorizer is always invoked regardless of whether headers are present. The authorizer resolves the session and always allows the request through. The app reads the session context and handles redirects. Trade-off: 2 Lambda invocations per request, no caching.

2. **In-process session resolution** (`createInProcessSessionHandle()`) — the SvelteKit handler reads the session cookie and queries DynamoDB directly within the handle hook. No authorizer Lambda involved. Trade-off: the handler Lambda has DynamoDB access to the sessions table.

## Consequences

### Positive

- The cached authorizer pattern remains the recommended approach for SPA + API architectures — no regression for existing consumers.
- SSR apps have two well-documented patterns to choose from based on their constraints.
- The `authorizerCache` CDK prop gains a `"disabled"` option that removes `identitySource`, keeping the API surface minimal.

### Negative

- SSR apps cannot benefit from API Gateway authorizer caching — every request incurs either a second Lambda invocation or a DynamoDB read.
- Documentation must clearly explain when each pattern applies — risk of consumers choosing the wrong one.
- Two code paths to maintain for session resolution (authorizer-based and in-process).

## Alternatives Considered

### Make the authorizer return 200 with anonymous context when cookie is missing

Not possible. When `identitySource` is configured, API Gateway rejects the request before invoking the authorizer if the specified header is absent. This is gateway-level behavior, not controllable from the authorizer code.

### Use CloudFront Functions to inject a placeholder cookie

Rejected. Adding synthetic cookies to satisfy `identitySource` creates confusion in the authorizer (must distinguish real vs. placeholder cookies) and couples the CDN layer to auth internals.

### Move to REST API Gateway (v1) which has different authorizer semantics

Rejected. REST API Gateway has higher per-request cost, no native JWT support, and the project is standardized on HTTP API Gateway.
