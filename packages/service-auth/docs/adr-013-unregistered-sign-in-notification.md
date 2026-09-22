# ADR-013: Notify Instead of Leaking on Unregistered Sign-In

## Status

Accepted

## Context

When `allowSignUp` is `false` and a sign-in is completed for an email address that has no account, `signInComplete` previously emitted an `UnsuccessfulAuth` event with `reason: "Email not registered."` and then threw `BadRequestError("Email not registered.")`, which the API surfaced to the client as an HTTP 400 with that message.

Returning a distinct error for unregistered addresses lets an attacker enumerate which addresses have accounts: submit an address, observe whether the response says "email not registered" or behaves like a real sign-in, and learn account existence. Reaching this branch already requires possession of the emailed one-time code (the action token is consumed first), but the response still differed enough between the registered and unregistered cases to be a signal.

Two things were wanted: stop leaking the signal to the client, and give the legitimate owner of the address a way to find out that someone attempted to sign in with their email so they can contact an administrator.

Separately, consumers had no reliable way to distinguish "email not registered" from other unsuccessful-auth reasons — `UnsuccessfulAuth.detail` carried only a free-text `reason` plus a nullable `emailAddress`, and matching on the exact reason string is brittle.

## Decision

Three coordinated changes:

1. **`UnsuccessfulAuth.detail` becomes a discriminated union on a required `code`.** Two variants: `{ code: "invalidToken", reason }` for a bad/expired/used code (no address is known at that point), and `{ code: "emailNotRegistered", emailAddress, reason }` for the unregistered-address case (the address is always known). The consumer-facing schema in `events.ts` uses `v.variant("code", [...])`; the producer interface in `src/events.ts` mirrors it.

2. **`signInComplete` no longer throws for an unregistered address.** It emits `UnsuccessfulAuth` with `code: "emailNotRegistered"` and returns the same response shape as a successful sign-in (a `303` redirect, or `200` JSON for `Accept: application/json`) **without** setting a session cookie. No session is created. The response is indistinguishable from a real sign-in to a client that cannot read the (absent) cookie.

3. **The notification email lives in the event consumer, not in `service-auth`.** The dashboards' `authConsumer` branches on `code === "emailNotRegistered"` and sends an email to the attempted address telling them someone tried to sign in with their email but it is not registered, and to contact an administrator.

## Rationale

### 1. A discriminated union over a required `code` beats string-matching `reason`

`reason` is human/log-facing free text; any wording change would silently break a consumer that matched on it. A required `code` gives a stable machine-readable discriminator. Modelling `detail` as a `v.variant` (rather than a single object with an optional field) lets each variant declare exactly the fields it can provide: `emailNotRegistered` guarantees a non-null `emailAddress`, so the consumer narrows on `code` and reads `emailAddress: string` with no null check, and `invalidToken` carries no address rather than a meaningless `null` or empty string.

### 2. Success-shaped, session-less response is the standard anti-enumeration defence

The client cannot distinguish registered from unregistered addresses by status code, body, or the presence/absence of a redirect. The only difference is that no session cookie is set — which is not an observable distinguishing signal at the auth-response boundary, since an attacker who lacks the OTP code cannot obtain a session on the registered path either.

### 3. Sending email is a consumer concern

`service-auth` is a pure event producer; it already delegates all email sending (including the OTP itself via `EmailCodeAuth`) to consumers. Keeping the notification in the dashboards' `authConsumer` preserves that separation and reuses the existing `emails.grantAccess(authConsumer)` wiring and the existing `AuthEventsRule`, which already subscribes `UnsuccessfulAuth`.

## Consequences

Positive:

- The client can no longer enumerate accounts via the unregistered-address response.
- The legitimate owner of an attempted address is notified and can escalate to an administrator.
- Consumers gain a stable `code` discriminator and precise per-variant typing.
- No CDK change was required — `UnsuccessfulAuth` was already subscribed in both dashboards.

Negative / trade-offs:

- **Breaking change to the `UnsuccessfulAuth` event contract.** `code` is now always present, and `emailAddress` exists only on the `emailNotRegistered` variant. Consumers that read `detail.emailAddress` unconditionally must first narrow on `code`. Released as a minor version with a migration note in the changeset; consumers are internal.
- A completed sign-in for an unregistered address now returns a success-shaped response instead of a 400. Callers that relied on the 400 (there were none in-repo) would need updating.
- The notification can be triggered per successful OTP use; volume is bounded by the `/auth/signInRequest` per-address throttle and by requiring possession of the code. No additional throttle was added.

## Alternatives Considered

### Keep `code` optional with a nullable `emailAddress`

A single `v.object` with `code?: ...` and `emailAddress: string | null`. Backward compatible, but leaves `emailAddress` nullable on every variant, forces a null check in the consumer for a field that is always present on the only variant that uses it, and lets emitters forget to set `code`. Rejected in favour of the honest, required discriminated union.

### Match on the free-text `reason`

No schema change; the consumer matches `reason === "Email not registered."`. Rejected — brittle to any copy change and offers no compile-time guarantee.

### Keep throwing a 400 (optionally with a generic message)

Return a uniform generic error for all failures instead of a success-shaped response. This still exposes a status/body that differs from the real sign-in success path unless every failure and success is made byte-identical, which is harder to guarantee than simply mirroring the success response. Rejected in favour of the success-shaped, session-less response.

### Send the notification email from `service-auth`

Have the service send the email directly. Rejected — `service-auth` deliberately produces events and never sends email; sending from the consumer reuses existing infrastructure and keeps the boundary intact.

## References

- `.kiro/plans/unregistered-sign-in-notification.md` — the implementation plan.
- ADR-006 — multi-app event isolation (event source scoping consumed here).
