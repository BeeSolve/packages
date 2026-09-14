# ADR-010: No `ImpersonationExpired` Event

## Status

Accepted

## Context

The impersonation feature emits two EventBridge events for audit: `ImpersonationStarted` (when the SDK `impersonate` command creates a session) and `ImpersonationEnded` (when `/auth/endImpersonation` explicitly terminates one). A third event, `ImpersonationExpired`, was considered for the case where an impersonation session simply lapses — the operator walks away and the session reaches its `expiresAt` without being explicitly ended.

Impersonation sessions are ordinary session rows with an `impersonatedBy` attribute. Like all sessions, they expire via the DynamoDB TTL on the `expiresAt` attribute and are treated as expired by the authorizer the moment `Date.now() > expiresAt`. There is no existing mechanism in the service that emits an event when a session expires.

The question was whether impersonation expiry warrants a dedicated event, and if so, how to detect the expiry reliably.

## Decision

We do not emit an `ImpersonationExpired` event. The event type, its producer and consumer schemas, the type guard, the optional DynamoDB stream on the Sessions table, and the stream-processing Lambda are all omitted from the feature.

Downstream consumers that need to react to an expired impersonation session read the session context: the authorizer resolves an expired session to the `expired` result synchronously, exactly as it does for any normal session. Audit trails reconstruct the lifecycle from `ImpersonationStarted` plus either `ImpersonationEnded` (explicit end) or the absence of an end paired with the known `expiresAt` (lapse).

## Rationale

### 1. Symmetry with normal session expiry

The service does not emit an event when a normal session expires — expiry is observed synchronously by the authorizer and surfaced through the session context. An impersonation session is a normal session with one extra attribute. Emitting an event for impersonation expiry but not for normal session expiry would be an inconsistent, special-cased behavior with no clear justification. Treating both the same keeps the model coherent.

### 2. TTL deletion is not a timely expiry signal

The only feasible way to detect a lapse (as opposed to an explicit end) without a request arriving is to observe the row's removal. DynamoDB TTL deletion is best-effort: an item is typically deleted within a few days of its expiry timestamp, and AWS documents deletion latency of up to 48 hours. An `ImpersonationExpired` event driven by a TTL-delete stream would therefore fire an arbitrary amount of time — up to 48 hours — after the session actually expired. For an audit or security signal this is misleading, and for any real-time reaction it is unusable, because the authorizer already treats the session as expired the instant `now > expiresAt`.

### 3. The stream approach also cannot cleanly distinguish lapse from explicit end

A DynamoDB stream fires `REMOVE` for every deletion, including the explicit delete performed by `/auth/endImpersonation` and by bulk session cleanup. Distinguishing a TTL-driven removal from an application-driven one requires inspecting the stream record's `userIdentity` service-principal marker, and even then only removes the double-emit problem — it does nothing about the up-to-48h latency. The mechanism is both imprecise and late.

### 4. Cost and complexity are not justified

Enabling a stream on the Sessions table adds stream read units and a dedicated Lambda with EventBridge permissions. That is real cost and operational surface for an event that is, at best, an eventually-consistent duplicate of information already available synchronously from the session context.

## Consequences

Positive:

- The feature is simpler: no stream, no extra Lambda, no extra IAM grant, no `impersonationExpiredEvents` CDK prop, and no `ImpersonationExpired` schema/guard to maintain.
- No misleading, delayed audit events. Consumers are not tempted to build real-time logic on a signal that can arrive up to 48 hours late.
- The Sessions table keeps its existing shape; enabling a stream later remains possible if a genuine need arises.

Negative:

- There is no push notification when an impersonation session lapses without an explicit end. Consumers that want to record lapses must infer them from `ImpersonationStarted` plus the known `expiresAt`, or observe the `expired` session context on the next request carrying that cookie.
- An abandoned session (never revisited) produces no terminal event at all. This is accepted, and is identical to how normal abandoned sessions behave.

## Alternatives Considered

### DynamoDB Streams on TTL deletion

Enable `NEW_AND_OLD_IMAGES` on the Sessions table and deploy a Lambda that filters `REMOVE` records with an `impersonatedBy` attribute, emitting `ImpersonationExpired`. Rejected because TTL deletion latency (up to 48 hours) makes the event untimely, it cannot distinguish lapse from explicit end without extra record inspection, and it adds a stream plus Lambda cost for a low-value signal.

### Emit from the authorizer on the `expired` branch

Have the authorizer emit `ImpersonationExpired` when it resolves an expired session that carries `impersonatedBy`. This gives accurate timing (fires on the first request after expiry), but couples the authorizer — deliberately kept lightweight and free of EventBridge dependencies — to the event bus, and still emits nothing for a truly abandoned session. Rejected in favor of the symmetry argument: normal expired sessions are not evented from the authorizer either.

### Scheduled sweep

A periodic Lambda queries the `userId` GSI for impersonation sessions past `expiresAt` and emits events on a fixed cadence. Provides bounded latency without a stream, but introduces a scheduled job, query cost, and additional state (tracking which lapses were already emitted). Rejected as disproportionate to the value of the event.

## References

- `.kiro/plans/auth-impersonation.md` — the implementation plan (its original "Resolved Decisions #1" proposed the DynamoDB Streams approach, which this ADR supersedes).
- ADR-009 — session rotation and expiry handling.
