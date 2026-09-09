# ADR-009: Session Rotation Design Decisions

## Status

Accepted

## Context

The `@beesolve/auth-service` uses cookie-based sessions backed by DynamoDB. When a session is "refreshed," the system creates a new session record with a new ID (the cookie value changes), rather than updating the existing record in-place. This document captures the reasoning behind the key design decisions in the rotation mechanism.

## Decisions

### 1. The 15-second drift guard exists to handle browser race conditions

When a browser loads a page, it often fires multiple concurrent requests (HTML, API calls, prefetches). If the authorizer rotates the session on the first request, the remaining in-flight requests still carry the old session ID in their cookies — they haven't received the `Set-Cookie` response yet.

Without the drift guard, each of these concurrent requests would attempt its own rotation, creating multiple new session records and potentially invalidating the one that was just created by the first request.

The 15-second window ensures that once a rotation happens, all requests arriving within that window see the freshly-created session record and skip rotation. This matches the typical time for a browser to complete a page load and process `Set-Cookie` headers.

### 2. Refresh interval is decoupled from authorizer cache TTL

Originally, the authorizer was cached by API Gateway (e.g. 1 hour), so the authorizer Lambda only ran once per cache period — implicitly limiting rotation frequency.

SSR apps (SvelteKit on Lambda) require `authorizerCache: "disabled"` because the authorizer must run on every request to set cookies. Without a separate refresh interval, this caused rotation on nearly every page load (any request arriving >15s after the last rotation), generating unnecessary DynamoDB writes and `Set-Cookie` headers.

The `sessionRefreshInterval` (default 1 hour) explicitly controls rotation frequency independent of cache mode. The authorizer can run on every request, but the session is only rotated when the current record is older than the interval.

### 3. Rotation creates a new record instead of updating in-place

When rotation happens, the system:

1. Creates a new session record (new `id`, same `sessionId` and `startedAt`)
2. Shortens the old record's TTL (rather than deleting it)

Creating a new record means the old session ID remains valid briefly. Requests that were already in-flight with the old cookie still resolve correctly when they hit the authorizer — the old record still exists and hasn't expired yet.

If we updated in-place (changing the `id` field), the old cookie value would immediately become invalid, causing auth failures for concurrent requests.

### 4. Old session gets a short TTL rather than immediate deletion (drain pattern)

When rotation occurs, the old session record's `expiresAt` is set to `min(drift * 2, remainingLifetime)` from now (i.e. ~30 seconds). This provides:

- A graceful transition window where both old and new session IDs are valid
- Protection against race conditions where the browser hasn't yet processed the new `Set-Cookie`
- Automatic cleanup via DynamoDB TTL — no explicit deletion needed

Immediate deletion would risk:

- Concurrent requests with the old cookie receiving 401s
- The browser retrying with the old cookie before processing the new one

### 5. Trade-off: DynamoDB cost vs security

Session ID rotation limits the window during which a stolen cookie is usable. Each rotation invalidates the old ID (after a brief drain), so an attacker must use a stolen cookie before the next rotation.

| Refresh Interval | Rotations/day (per session) | DynamoDB writes/day | Stolen cookie window |
| ---------------- | --------------------------- | ------------------- | -------------------- |
| 15 seconds       | ~5,760                      | ~11,520             | 15 seconds           |
| 1 hour (default) | ~24                         | ~48                 | Up to 1 hour         |
| 4 hours          | ~6                          | ~12                 | Up to 4 hours        |

The 1-hour default balances security (cookie rotation happens frequently enough to limit exposure) against cost (minimal DynamoDB write load).

For higher-security applications, reduce the interval. For cost-sensitive apps with lower security requirements, increase it.

## Consequences

- Session rotation frequency is explicit and configurable, not an accidental side effect of cache configuration
- SSR apps with `authorizerCache: "disabled"` no longer generate excessive DynamoDB writes
- The drift guard and refresh interval serve orthogonal purposes and can be tuned independently
- Existing deployments with authorizer caching are unaffected — the cache already limits authorizer invocations, and the 1-hour default interval matches common cache TTLs
