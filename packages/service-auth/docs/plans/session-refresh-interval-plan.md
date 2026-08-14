# Session Refresh Interval — Decoupling from Authorizer Cache

## Problem

Session rotation currently happens on every authorizer invocation (subject only to the 15s `refreshDrift` guard). This worked when the authorizer was cached — with a 1-hour cache TTL, the authorizer only ran once per hour, implicitly limiting rotation frequency.

With `authorizerCache: "disabled"` (required for SSR apps), the authorizer runs on every request. The 15s `refreshDrift` only prevents rotation from concurrent requests within a short window (browser race condition where multiple requests fire before the new cookie is received). It does NOT control the refresh frequency — any request arriving >15s after the last rotation triggers a full rotation.

Result: a new session record is created on nearly every page load, generating unnecessary DynamoDB writes and `Set-Cookie` headers.

## Current Logic in `sessions.refresh()`

```
1. Is session younger than refreshDrift (15s)?
   → YES: skip rotation, return existing session (browser race guard)
   → NO: rotate (create new record, shorten old record's TTL)
```

## Desired Logic

```
1. Is session younger than refreshDrift (15s)?
   → YES: skip rotation, return existing session (browser race guard)
   → NO: continue to step 2

2. Is session younger than refreshInterval?
   → YES: skip rotation, return existing session (not time to rotate yet)
   → NO: rotate (create new record, shorten old record's TTL)
```

The two checks serve different purposes:

- **`refreshDrift` (15s)** — guards against browser race conditions where concurrent requests arrive before the new cookie is set. Uses `createdAt` (the session record's creation time).
- **`refreshInterval` (e.g. 1h)** — controls how often the session is actually rotated. Uses `createdAt` as well — if the current session record was created less than `refreshInterval` ago, don't rotate.

## Design

### New Setting: `sessionRefreshInterval`

```ts
interface CoreProps {
  // ... existing props ...
  /**
   * Minimum time between session rotations. When the authorizer runs and the
   * current session record is younger than this interval, rotation is skipped.
   *
   * This is independent of authorizer cache — the authorizer can run on every
   * request, but the session is only rotated at this interval.
   *
   * @default Duration.hours(1)
   */
  readonly sessionRefreshInterval?: Duration;
}
```

### New Env Var

```
SESSION_REFRESH_INTERVAL=3600000  # milliseconds
```

### Implementation in `Sessions`

```ts
export class Sessions {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly userIdIndexName: string;
      readonly defaultMaxAge?: number;
      /** Browser race condition guard. @default 15_000 (15s) */
      readonly refreshDrift?: number;
      /** How often to rotate the session. @default 3_600_000 (1h) */
      readonly refreshInterval?: number;
    },
  ) {}

  readonly refresh = async (props) => {
    const start = new Date();
    const drift = this.props.refreshDrift ?? 15_000;
    const interval = this.props.refreshInterval ?? 3_600_000;

    const age = start.getTime() - Date.parse(props.session.createdAt);

    // Guard: browser race condition — session record just created
    if (age < drift) {
      return { newSession: props.session, maxAge: this.remainingMaxAge(props, start) };
    }

    // Guard: not time to rotate yet
    if (age < interval) {
      return { newSession: props.session, maxAge: this.remainingMaxAge(props, start) };
    }

    // Rotate the session
    // ... existing rotation logic ...
  };
}
```

Both guards return the existing session with a recalculated `maxAge` (remaining lifetime). No new record, no transaction, no new cookie value — just the same `Set-Cookie` with updated expiry.

### Cookie Behavior

| Condition           | New Session Record | New Cookie Value | Set-Cookie Header          |
| ------------------- | ------------------ | ---------------- | -------------------------- |
| age < drift (15s)   | No                 | No (same SID)    | Yes (refresh expiry)       |
| age < interval (1h) | No                 | No (same SID)    | Yes (refresh expiry)       |
| age >= interval     | Yes                | Yes (new SID)    | Yes (new SID + expire old) |

## Task Breakdown

### Task 1: Add `refreshInterval` to `Sessions` constructor ✅

- Add `readonly refreshInterval?: number` prop (milliseconds)
- Add the second guard in `refresh()` after the existing drift check
- Extract `remainingMaxAge` helper to avoid duplication

### Task 2: Add CDK prop and env var ✅

- Add `sessionRefreshInterval?: Duration` to `CoreProps`
- Compute `SESSION_REFRESH_INTERVAL` env var (milliseconds string)
- Pass to auth API handler, session authorizer, and in-process authorizer
- Default: `Duration.hours(1)`

### Task 3: Wire up in authorizer and in-process handle ✅

- `sessionAuthorizer.ts`: read `BEESOLVE_AUTH_SESSION_REFRESH_INTERVAL` env var, pass to `Sessions` constructor
- Auth API handler: read `SESSION_REFRESH_INTERVAL`, pass to `Sessions` constructor

### Task 4: Update tests ✅

- Test that rotation is skipped when `age < refreshInterval`
- Test that rotation happens when `age >= refreshInterval`
- Test that the drift guard still works independently (age < drift always skips, even if interval is 0)

### Task 5: Verify ✅

- Deploy with `authorizerCache: "disabled"` and default 1h interval
- Confirm rapid page refreshes reuse the same session record
- Confirm session rotates after 1 hour
- Confirm existing cached-authorizer deployments are unaffected (they already rotate infrequently due to cache TTL)

### Task 6: Document session authorizer behavior ✅

After the implementation is complete and verified, create comprehensive documentation:

1. **ADR: Session Rotation Design Decisions** (`docs/adr-session-rotation.md`)
   - Why the 15s drift exists (browser race condition — multiple requests fire before `Set-Cookie` is processed by the browser, each hitting the authorizer with the old SID)
   - Why refresh interval is decoupled from cache TTL (SSR apps need `authorizerCache: "disabled"` but shouldn't rotate on every request)
   - Why rotation creates a new record instead of updating in-place (old SID in-flight requests still resolve; gradual cookie transition)
   - Why `drainWhenValid: true` pattern — old session gets a short TTL rather than immediate deletion (graceful transition for concurrent requests)
   - Trade-off: DynamoDB cost (write per rotation) vs security (session ID rotation limits stolen cookie window)

2. **Documentation: Session Authorizer Lifecycle** (`docs/session-authorizer-lifecycle.md`)
   - Full request lifecycle from browser to response, including:
     - Cookie parsing
     - Session lookup
     - Expiry check
     - Refresh decision tree (drift guard → interval guard → rotate)
     - Cookie response (same SID with updated expiry vs new SID + expire old)
     - Authorizer context passed to Lambda
   - Mermaid sequence diagram showing the full flow
   - Mermaid flowchart showing the refresh decision tree
   - Explanation of all configuration knobs (`sessionDuration`, `sessionRefreshDrift`, `sessionRefreshInterval`, `authorizerCache`)
   - Behavior matrix: how different combinations of cache mode and refresh interval interact
