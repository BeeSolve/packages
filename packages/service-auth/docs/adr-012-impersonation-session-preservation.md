# ADR-012: Impersonation as an In-Place Session Mutation

## Status

Accepted

## Context

Impersonation lets an impersonator (admin, support agent) act as another user for debugging and support, while preserving an audit trail of who initiated it. The design question is what a session looks like while impersonation is active, and how starting and stopping impersonation change session state.

Two earlier designs were explored and rejected before arriving at the current one:

1. **An independent impersonation session.** Starting impersonation minted a brand-new session for the target user, tagged with the impersonator, and swapped the impersonator's `__Host-SID` cookie onto it while leaving their own session untouched in the database. This extended the impersonator's authenticated window (a session with one hour of life left could impersonate for four), left the impersonator's original session live and replayable under an id that had been exposed as a cookie, and could not faithfully return the impersonator to the session they had.

2. **Copy the original to an inactive row, then disable and restore it.** Starting impersonation copied the impersonator's session into a fresh dormant row (`active: false`), deleted the live original to burn its exposed id, and minted a capped impersonation session referencing the dormant copy; stopping impersonation reactivated the copy. This fixed the replay and privilege-extension problems but at a high cost: an `active` flag with an authorizer guard, a copy step, a reference field, restore/logout branching, and lifetime math (`min(requestedMaxAge, maxImpersonationDuration, originalRemaining − offset)`) to keep the impersonation window inside the original's expiry.

We reviewed how established solutions handle impersonation:

- **Auth0** (legacy, now deprecated) issued an impersonation login URL and marked the resulting profile with `impersonated: true` and an `impersonator` object. The industry — Auth0 included — has since moved away from URL-based impersonation toward session-based impersonation carrying explicit impersonator claims.
- **Better Auth** (official `admin` plugin) creates a real session for the target user with `impersonatedBy` set and a short configurable duration, and on stop deletes the impersonation session and restores the admin session — but it parks the admin's original session token **client-side in a second signed cookie**. Its own issue tracker shows this restoration state is fragile across nested impersonation (a restored cookie can lose its `Max-Age`).
- **Hanko** and others follow the same session-based, impersonator-claim shape.

The common thread across all of these — and across both of our earlier designs — is that impersonation is modelled as a _second_ session that has to be created, bounded, and later reconciled with the impersonator's real one. That reconciliation is the source of every hard problem above: lifetime math, orphaned rows, replay windows, and fragile restoration state.

## Decision

Impersonation is a reversible mutation on the impersonator's **own** session. There is one session row throughout, always owned by and queried under the real (impersonator) user. Impersonation is expressed by an optional `impersonatedId` attribute on that row:

- **Start** = `SET impersonatedId = <targetUserId>` on the impersonator's session (an `UpdateCommand` guarded by `attribute_exists(id)`).
- **Stop** = `REMOVE impersonatedId` from the same row (same guard).

No new session is created, no cookie is issued or swapped, there is no separate impersonation lifetime, no cap, no `active` flag, no copy, no reference field, and no restore/logout fork.

Identity is projected at a single boundary. `toValidSession` is the only place that reads `impersonatedId` and turns a stored session into the client-facing `ValidSession` context:

- If `impersonatedId` is set → `{ userId: impersonatedId, sessionId, expiresAt, impersonating: true, impersonatedBy: <owner's userId> }`.
- Otherwise → `{ userId, sessionId, expiresAt, impersonating: false }`.

So in the projected context `userId` is always the _effective_ user (the target while impersonating) and `impersonatedBy` is the real owner. The stored row's raw `userId` remains the impersonator; the swap happens only in the projection. The authorizer builds every `ValidSession` through `toValidSession`, so nothing downstream ever reads the raw `userId` directly.

`refresh` (session rotation, ADR-009) carries `impersonatedId` onto the rotated row, so impersonation survives rotation without special handling.

## Rationale

### 1. It dissolves the lifetime problem entirely

There is one session and one `expiresAt`. Because impersonation never mints a second session, there is nothing to cap and no window to fit inside another window. The privilege-extension concern from the independent-session design simply cannot arise: the impersonator's session expires exactly when it always would, whether or not it is impersonating. This removes `maxImpersonationDuration`, the per-request `maxAge`, and all the `min(...)` lifetime arithmetic from the copy design.

### 2. No orphan or replay surface

No new id is ever exposed as a cookie, and no row is left behind. The impersonator keeps presenting the same `__Host-SID` they already had. There is nothing to burn, nothing to restore, and no dormant copy that could be resurrected.

### 3. Stopping is trivial and always correct

Stop is a single `REMOVE`. There is no "is the original still present?" lookup, no reactivation, and no logout fork. The same row reverts to a normal session in place.

### 4. Sign-out-all-devices works automatically

The impersonation session is the impersonator's own row, indexed under the impersonator's `userId`. A global sign-out for the impersonator (`deleteAllForUser`) therefore removes it like any of their other sessions, with no special-casing. There is no inactive copy to also remember to delete.

### 5. The single cost is a projection discipline

The one thing this model _requires_ is that identity is only ever read through the projected context, because the stored row's raw `userId` is the impersonator, not the effective user. That discipline is enforced structurally: `toValidSession` is the only projection boundary and the authorizer routes every session through it. Consumers read `session.userId` (effective) and narrow on `session.impersonating`; they never touch the raw row.

## Consequences

Positive:

- Dramatically simpler than either earlier design: no `active` flag, no authorizer guard for it, no copy, no reference field, no restore/logout branching, no lifetime cap, no `maxImpersonationDuration` prop or env var.
- No privilege extension, no orphaned replayable session, and global sign-out is honored — the same properties the copy design achieved, but for free.
- Impersonation survives session rotation with no extra logic.

Negative — the critical edge case (must be understood by consumers):

- **Acting-as-current-user operations affect the target, not the impersonator.** While impersonating, the projected `session.userId` is the _target_. Any operation that acts on "the current user" keyed off `session.userId` therefore operates on the target. The sharpest example: a "sign out of all my devices" action keyed on `session.userId` would delete the **target's** sessions, not the impersonator's. Callers that expose such operations must be aware that, under impersonation, they act on the impersonated user.
- **The impersonation session follows the impersonator's lifecycle.** The row is owned by the impersonator, so the impersonator's own sign-out (or global sign-out) ends it; the target signing out elsewhere does not. This is the intended ownership model, but it means impersonation is bounded by the impersonator's session, not the target's.
- **`targetUserId` is not validated.** The `impersonate` command trusts `targetUserId` and does not check it against any account — the auth-service treats user ids as opaque and does not own the user directory, consistent with authorization being the caller's responsibility. Impersonating a non-existent id fails safe (the effective session resolves to a user that owns nothing), but ensuring the target is a real, authorised user is the caller's responsibility.

A possible future mitigation for the first point is a caller-side check, or a `force`/param on the sign-out endpoint that detects an impersonating session and refuses (or redirects) rather than acting on the target. This is intentionally **out of scope** for now: there are no consumers that need it yet, and adding it prematurely would reintroduce complexity the mutate model exists to avoid.

## Alternatives Considered

### Independent impersonation session, original left untouched

Rejected: allowed privilege extension (impersonation could outlive the impersonator's own credential), left a live replayable original session under an exposed id, and could not faithfully restore the impersonator.

### Copy the original to an inactive row + `active` flag + restore/logout

Rejected: it did achieve no-privilege-extension and replay resistance, but only through substantial machinery — an `active` attribute with an authorizer guard, a dormant copy, a reference field, restore/logout branching, and `min(...)` lifetime math to keep the impersonation window inside the original's expiry. The mutate-in-place model reaches the same security properties with none of it.

### Park the original token in a client cookie (Better Auth)

Rejected: keeps a live, directly-usable session during impersonation and stores restoration state client-side, which is fragile across nested impersonation and risks leaking the reference to the user.

### A `maxImpersonationDuration` cap / bounded impersonation lifetime

Rejected: a cap only exists to bound a _separate_ impersonation session. With one session and one expiry there is nothing to cap. Removed entirely.

## References

- ADR-009 — session rotation and expiry handling (`impersonatedId` is carried across rotation).
- ADR-010 — why impersonation expiry is not evented; still valid under this model, since an impersonating session lapses exactly like any normal session.
- Better Auth admin plugin (`impersonateUser` / `stopImpersonating`) and its issue tracker (client-cookie restoration fragility).
- Auth0 legacy impersonation (deprecated).
- Hanko impersonation (session-based, impersonator-claim shape).
