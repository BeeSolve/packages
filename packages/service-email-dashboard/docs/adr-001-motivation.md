# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Clients that use `@beesolve/email-service` to send transactional email have no way to see what their email pipeline is actually doing. The service sends through SES, writes a short-lived "sent log" to its own `EmailLog` DynamoDB table, and emits EventBridge events for the full delivery lifecycle (`EmailSentSuccess` / `EmailSentFailure` from the service, plus `SES Message Sent` / `SES Delivery` / `SES Bounce` / `SES Complaint` / `SES Reject` from SES itself). What is missing is any persisted, queryable delivery **status** and any UI to inspect it.

Reading `service-email`'s `EmailLog` table directly is not a viable substitute:

- **No status.** `EmailLog` records the request payload, not the delivery outcome. Whether a message was delivered, bounced, complained about, or rejected exists **only** in the EventBridge event stream — nowhere in `EmailLog`.
- **No query access paths.** `EmailLog` is keyed for the service's own point lookups (by `requestId`, by recipient). It has no time-ordered index for "show me the last N messages" and no per-recipient or global aggregates.
- **Short, configurable TTL.** `EmailLog` records expire (default `messagesRetentionDays`, ~14 days) and may not be persisted at all if `messagesRetentionDays: 0`. It is not a durable historical record.

The motivation ADR of `service-email` itself names an email dashboard as intended future work. This package is that dashboard.

## Decision

Ship a standalone package, `@beesolve/email-service-dashboard`: a prebuilt [kit-on-lambda](https://www.npmjs.com/package/kit-on-lambda) SvelteKit application that exports a single CDK construct (`./cdk`). The construct provisions the SSR Lambda behind CloudFront, wires `@beesolve/auth-service` email-code authentication, provisions its own `@beesolve/email-service` `Emails` construct for sign-in OTP mail, and runs an **event-ingest Lambda** that consumes the email lifecycle events off EventBridge and **projects them into the dashboard's own DynamoDB table**.

The dashboard owns its own projection. It does not read `service-email`'s tables. It subscribes to the same EventBridge events that SES and the service emit, and it persists the delivery status, per-message timeline, and aggregate counters it needs to serve the UI. Message **bodies** are the one exception: they are never stored, and are fetched on demand via `email.getMessage(requestId)` while the source `EmailLog` record still exists.

## Rationale

### 1. Delivery status lives only in events, not in any readable table

The single fact that forces a dedicated projection: delivery outcomes are only ever observable as EventBridge events. There is no table anywhere that already has this data in a queryable shape. Something has to capture the event stream durably, and the dashboard is the natural owner of that projection because it is the thing that needs to read it.

### 2. A projection shaped for the UI's access paths

The dashboard needs time-ordered message listing, per-month listing, per-recipient history, and global + per-recipient aggregate counters — all without `Scan` or `FilterExpression`. Owning the projection lets us design the key layout (see ADR-002) around exactly those queries rather than contorting reads against a table designed for the service's needs.

### 3. Decoupled lifecycle and blast radius

The dashboard is deployed, versioned, and torn down independently of `service-email`. It reads the event bus, so it adds no load and no coupling to the send path. If the dashboard's table is deleted, the email service is unaffected; if the dashboard falls behind on ingest, sending continues normally.

### 4. Same construct + auth pattern as the rest of the fleet

It follows the established `@beesolve/dmarc-dashboard` template: a prebuilt SvelteKit bundle exporting one `./cdk` construct, `AuthGateway` email-code auth, and its own OTP `Emails`. Consumers get a drop-in dashboard with one construct instantiation.

## Consequences

- Consumers get a durable, queryable delivery history and a UI with a single construct, independent of the email service's own retention settings.
- The dashboard maintains a second copy of delivery data (the projection). This is the accepted cost of the event stream being the only source of truth for status.
- Message bodies remain bounded by `service-email`'s `EmailLog` TTL — the dashboard stores none, so "view body" degrades gracefully to "no longer available" once the source record expires.
- `EmailSentFailure` events carry no `messageId`, so failures cannot be tied to a message record; they are counted as an approximate global stat only (see ADR-002).

## Alternatives Considered

### Read `service-email`'s `EmailLog` table directly

Rejected. `EmailLog` has no delivery-status field, no time-ordered or aggregate access paths, and a short TTL. It cannot answer "was this delivered / did it bounce", cannot list messages by time, and does not retain history. The status data simply is not there — it is only in the events.

### Add the dashboard's projection into `service-email` itself

Rejected. It would couple the dashboard's data model and deployment lifecycle to the email service, expand the service's blast radius, and force every `service-email` consumer to carry dashboard tables whether or not they want the UI. Keeping the projection in a separate, opt-in package preserves the service's minimal surface.

### Make this package a general email UI / replace `service-email`

Out of scope. The dashboard is a read-side projection plus UI, with its own auth and OTP mail. It does not send application email, does not replace `service-email`'s SDK or send path, and is not a general-purpose mail client. Its responsibility boundary is: consume lifecycle events → project → display.
