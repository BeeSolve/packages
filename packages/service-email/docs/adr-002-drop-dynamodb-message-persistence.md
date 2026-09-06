# ADR-002: Drop DynamoDB Message Persistence

## Status

Accepted

Supersedes the DynamoDB delivery-logging portions of [ADR-001](./adr-001-motivation.md).

## Context

ADR-001 established DynamoDB delivery logging as a core capability: every sent email
was written to a DynamoDB table (partitioned by request id, plus a reverse index by
recipient) with a configurable TTL, and the SDK exposed `getMessage(requestId)` to read
it back. The stated motivation was that SES has no native "sent log", and ADR-001 even
anticipated a future dashboard built on top of that table.

That dashboard now exists as a separate package, `@beesolve/email-service-dashboard`.
Rather than reading the email-service DynamoDB table, the dashboard runs its own
event-ingest Lambda that consumes the delivery lifecycle from EventBridge (the
`beesolve.email.api` events this service emits, plus `aws.ses` events) and projects it
into the dashboard's **own** DynamoDB table. The dashboard is the "sent log" UI ADR-001
envisioned, but it owns its projection and stays decoupled from this service through
events. The full request body is stored on the dashboard's own S3 bucket when it
consumes `EmailSentSuccess`.

With the dashboard sourcing everything it needs from EventBridge and its own storage,
nothing consumes the email-service DynamoDB table or the `getMessage` SDK method. The
table had become a write-only second source of truth, duplicating data the dashboard
already derives from events.

## Decision

Remove DynamoDB message persistence from the email service:

- The CDK construct no longer provisions the `EmailLog` `TableV2`, and no longer grants
  the handler or `grantAccess` consumers read/write access to it.
- The handler no longer writes send records to DynamoDB.
- The SDK drops the `getMessage` method and the `BEESOLVE_EMAILS_TABLE_NAME` env var.
- The construct drops the now-unused props: `messagesRetentionDays`, `isProd`,
  `removalPolicy`, and `deletionProtection` (all of which only configured the table).

## Rationale

### 1. The dashboard replaced the table's only purpose

The DynamoDB table (and `getMessage`) existed to provide a queryable sent log — a job now
owned by `@beesolve/email-service-dashboard`, which builds its own projection from the
EventBridge lifecycle events this service emits. Keeping the email-service table meant
maintaining a second, write-only copy of data the dashboard already derives from events.

### 2. Events plus S3 already cover observability

`EmailSentSuccess` carries `requestId`, `messageId`, and the original request;
`EmailSentFailure` carries the failed `requestId`. Consumers (the dashboard included)
reconstruct the "what was sent" record from these events, and the dashboard persists the
full request body to its own S3 bucket. There is no need for this service to hold that
state too.

### 3. Smaller surface, cleaner decoupling

Removing the table deletes a stateful resource, its TTL/PITR/removal-policy configuration,
and four construct props. The email service now exposes exactly one integration contract —
EventBridge events — and the dashboard consumes them without any read dependency on this
service's storage or SDK.

## Consequences

- SES still has no queryable sent log inside this package. Consumers that want one should
  either deploy `@beesolve/email-service-dashboard` (which projects the EventBridge
  lifecycle into its own store and UI) or subscribe to the events directly.
- `getMessage` is removed from the public SDK. This is a breaking change to the SDK
  surface, released as a minor while the package has a single known consumer.
- Existing deployments retain their table unless removed separately — the construct simply
  stops managing it. Orphaned tables should be cleaned up manually.

## Alternatives Considered

### Keep the table but stop writing to it

Rejected. A provisioned-but-unused table still costs IAM surface and confuses future
readers about whether it is authoritative.

### Make persistence opt-in via a flag

Rejected. `messagesRetentionDays: 0` already effectively disabled it, and no consumer
needs the on path. Retaining the code and props for a disabled feature is dead weight.
