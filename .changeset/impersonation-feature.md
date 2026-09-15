---
"@beesolve/auth-service": minor
---

Add user impersonation support.

An impersonator (admin, support agent) can act as another user for support and debugging while preserving an audit trail of who initiated it. Impersonation is a reversible mutation on the impersonator's **own** session — no new session and no new cookie are created; the same session flips into impersonating mode by gaining an `impersonatedId` attribute.

- **SDK `impersonate` command** (`AuthClient.invoke({ type: "impersonate", request: { targetUserId, cookieHeader } })`) parses `__Host-SID` from the impersonator's cookie header and mutates that session server-side (`SET impersonatedId`). It returns nothing — the impersonator's existing cookie automatically resolves to an impersonating session on the next request.
- **`POST /auth/endImpersonation`** public endpoint ends impersonation by removing `impersonatedId` from the current session (the same session reverts to normal, with no cookie change) and emits `ImpersonationEnded` (JSON or 303 redirect via content negotiation).
- **Discriminated session context**: `ValidSession` is now a union — `{ ..., impersonating: false }` or `{ ..., impersonating: true, impersonatedBy }`. While impersonating, `userId` is the effective (target) user and `impersonatedBy` is the impersonator. Handlers that only read `session.userId` are unaffected; those that care can pattern-match on `session.impersonating`. This applies to both the authorizer-based path (`getSessionContext` / `createSessionHandle`) and the in-process path (`SessionAuthorizer` / `withSession` / `createInProcessSessionHandle`).
- **New EventBridge events**: `ImpersonationStarted` and `ImpersonationEnded` (`currentUserId` = impersonator, `targetUserId` = impersonated user).

Authorization is the caller's responsibility — the auth service authenticates but does not decide who may impersonate. The calling service must verify the impersonator's permission before invoking the SDK command.

Edge case: because the impersonation session is the impersonator's own and `session.userId` projects to the target while impersonating, "act as current user" operations keyed on `session.userId` (e.g. "sign out of all my devices") affect the **target**, not the impersonator. See the README Impersonation section and ADR-012.

BREAKING: `ValidSession` changes from a flat object to a discriminated union. Consumers that destructure or spread the entire session object must handle both variants; accessing `userId`, `sessionId`, or `expiresAt` directly continues to work unchanged.
