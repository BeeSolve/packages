# ADR-012: Impersonation Session Lifetime and Original-Session Preservation

## Status

Accepted

## Context

Impersonation lets an operator (admin, support agent) act as another user. An impersonation session is an ordinary session row with an `impersonatedBy` attribute recording who initiated it. The operator's browser swaps its `__Host-SID` cookie from its own session to the impersonation session.

The first implementation created an independent impersonation session and left the operator's original session untouched in the database while replacing its cookie. This produced several undesirable properties:

1. **Privilege extension.** An operator whose own session had, say, one hour of life left could impersonate for up to four hours, effectively extending their authenticated window beyond what their credential allowed.
2. **Orphaned live session.** The operator's original session stayed valid in the database with its physical id (the value that had been exposed as a cookie) intact. If that id had been captured, it remained replayable for the rest of its lifetime.
3. **No faithful restoration.** Ending impersonation minted a brand-new operator session with the default 30-day lifetime rather than returning the operator to the session they had, and a lapse (walking away) logged the operator out with no path back.

We reviewed how established solutions handle impersonation:

- **Auth0** (legacy, now deprecated) issued an impersonation login URL and marked the resulting profile with `impersonated: true` and an `impersonator` object. The industry — Auth0 included — has since moved away from URL-based impersonation toward session-based impersonation carrying explicit impersonator claims.
- **Better Auth** (official `admin` plugin) creates a real session for the target user with `impersonatedBy` set and a short configurable duration (default one hour). On stop it deletes the impersonation session and restores the admin session, but it stores the admin's original session token **client-side in a second signed cookie**. Its own issue tracker shows this restoration state is fragile across nested impersonation (a restored cookie can lose its `Max-Age`). Authorization (who may impersonate) lives entirely in its access-control layer, not the session layer.
- **Hanko** and others follow the same session-based, impersonator-claim shape.

Common best practices confirmed across these: a discriminated identity carrying the impersonator, a short bounded impersonation lifetime, authorization owned by the caller's permission layer rather than the auth layer, deleting the impersonation session on stop, and defaulting to the most secure behavior.

## Decision

Impersonation preserves the operator's original session **server-side as an inactive copy** and strictly bounds the impersonation lifetime so it always ends before the original would expire. There is a single strict behavior — no `lax`/`strict` option.

### Session `active` flag

Sessions gain an `active` attribute, `v.optional(v.boolean(), true)` in the Valibot schema: optional in DynamoDB (so no migration — existing rows without the attribute parse as `active: true`), but always a concrete boolean on the parsed output. The authorizer rejects any session where `active === false` (explicit comparison, so an absent/`true` flag stays usable). An inactive session is present in the database and reachable by the backend, but is not directly usable by anyone presenting its cookie.

### Starting impersonation

The SDK `impersonate` command receives the operator's **cookie header** (not a bare id), plus `targetUserId`, `currentUserId`, and an optional `maxAge`. The handler:

1. Parses `__Host-SID` from the cookie header and fetches the operator's session, re-validating that it is present, unexpired, and not itself an impersonation/inactive session. The original `expiresAt` is read authoritatively from the database — never trusted from the caller.
2. Computes the impersonation lifetime as `min(requestedMaxAge ?? 3600, maxImpersonationDuration ?? 14400, originalRemaining − offset)`, where `offset` is 5 minutes. If `originalRemaining ≤ offset`, the request is rejected: the operator's session is too close to expiry to carve out a valid impersonation window.
3. Copies the operator's original session into a **new row with a fresh random id** and `active: false` — this is the restorable, dormant original. Its `expiresAt` is unchanged.
4. **Deletes the operator's original (live) row**, burning the physical id that had been exposed as a cookie.
5. Creates the impersonation row: a new id, `userId` = target, `impersonatedBy` = operator, `originalSessionRef` = the inactive copy's id, and the capped `expiresAt`.
6. Emits `ImpersonationStarted` and returns the impersonation `sid` + `maxAge` for the caller to set as the operator's cookie.

`originalSessionRef` is internal only and is never included in the client-facing session context.

### Ending impersonation

`/auth/endImpersonation` reads the impersonation session from the cookie, verifies it is an impersonation session, and looks up `originalSessionRef`:

- If the inactive copy **exists and is unexpired**, it is restored (reactivated / reissued as the operator's cookie) and the impersonation session is deleted.
- If it is **absent** (for example, the operator performed "sign out of all devices" elsewhere while impersonating, which deletes their sessions including the inactive copy), nothing is restored — the operator's cookies are cleared and they are logged out.

`ImpersonationEnded` is emitted. Because the impersonation lifetime is capped below the original's expiry (step 2), the inactive copy is always still within its lifetime when impersonation ends normally, so no refresh of the original is ever required.

### "Sign out of all devices"

`deleteAllForUser` removes inactive copies as well as live sessions, so a global sign-out correctly makes the original unrestorable and the "is the original still present?" test in `endImpersonation` behaves as intended.

## Rationale

1. **No privilege extension (rule 1/2).** Capping impersonation to `originalExpiresAt − offset` guarantees the operator can never remain authenticated (as themselves or as the target) longer than their own credential allowed. Impersonation time counts against the operator; there is no clock pause and no refresh of the original.
2. **Replay resistance (rule 4).** Deleting the operator's original row invalidates the physical id that was exposed as a cookie. The preserved copy lives under a fresh id that is never sent to any client, so a captured original id cannot be replayed, and the copy cannot be used directly because it is `active: false`.
3. **Server-side restoration state (rules 3/7).** The reference to the original lives on the impersonation row in the database, not in a browser cookie. This avoids the client-cookie fragility seen in Better Auth's nested-impersonation bug and ensures the reference never leaks to the user.
4. **Authoritative restoration decision (rule 8).** Keeping the original as a real (if inactive) row lets `endImpersonation` decide whether to restore based on whether the row still exists. A global sign-out deletes it, so we correctly refuse to resurrect a session the user explicitly revoked.
5. **Secure by default.** A single strict behavior, no opt-out, matches the industry lean toward "as secure as possible by default."

## Consequences

Positive:

- Impersonation cannot outlive or extend the operator's own session.
- No orphaned, replayable live operator session exists during impersonation.
- Ending impersonation returns the operator to their genuine remaining lifetime; a global sign-out is honored.
- Restoration state is server-side and never exposed to the client.

Negative:

- More moving parts than an independent impersonation session: an `active` flag with an authorizer guard, an inactive copy, a reference field, and copy/restore logic.
- If an operator abandons impersonation and it lapses, there is no session to restore and they are logged out. This is intended: their original lifetime has been consumed, and this is consistent with ADR-010 (expired sessions are not resurrected or evented).
- A very short-lived operator session (≤ 5 minutes remaining) cannot start impersonation.

## Alternatives Considered

### Independent impersonation session, original left untouched (the first implementation)

Rejected: allowed privilege extension, left a replayable orphan session, and could not faithfully restore the operator.

### Keep the original alive and park its token in a client cookie (Better Auth)

Rejected: keeps a live, directly-usable operator session during impersonation (weaker replay posture) and stores restoration state client-side, which is fragile across nested impersonation and risks leaking the reference to the user.

### Refresh the original session to keep it alive during impersonation

Rejected: refreshing extends `expiresAt`, which is exactly the privilege extension rule 1 forbids. Capping impersonation below the original's expiry makes keeping the original alive unnecessary.

### Store the original as inert metadata rather than a row

Rejected: without a real (inactive) row there is nothing to look up, so the "is the original still present?" test that honors a global sign-out (rule 8) cannot be performed.

### `strict` / `lax` mode option

Rejected for now: there are no existing consumers, and a single secure behavior is simpler and safer. A `lax` mode can be added later only if a concrete need for impersonation longer than the operator's own session emerges.

## References

- ADR-009 — session rotation and expiry handling.
- ADR-010 — why impersonation expiry is not evented.
- `.kiro/plans/auth-impersonation.md` — implementation plan.
- Better Auth admin plugin (`impersonateUser` / `stopImpersonating`) and its issue tracker (client-cookie restoration fragility).
- Auth0 legacy impersonation (deprecated).
