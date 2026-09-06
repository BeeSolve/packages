# ADR-001: Why This Package Exists

## Status

Accepted

> **Note:** The DynamoDB delivery-logging capability described below was later removed.
> See [ADR-002](./adr-002-drop-dynamodb-message-persistence.md). The rest of this ADR
> (SQS delivery, S3 attachments, EventBridge notifications, simple SDK) still holds.

## Context

Sending transactional email on AWS means using SES. While SES itself is reliable, setting it up properly has been historically clunky and error-prone:

- Configuring verified identities, DKIM, and sending domains
- Handling bounces and complaints (required to maintain sending reputation)
- Implementing retry logic for transient SES failures
- Managing attachments (storing them, referencing them in the email)
- Tracking what was sent, when, and to whom (SES provides no built-in sent log)
- Ensuring delivery under Lambda concurrency limits (SES calls can fail if you send too many at once)

AWS has improved the SES experience over the years with new APIs and features, but the gap between "SES can send an email" and "I have a reliable, observable email delivery system" remains significant.

## Decision

Build an email service package that provides:

- **SQS-backed delivery queue** — emails are queued first, delivered by a dedicated consumer Lambda. This guarantees delivery even under concurrency pressure and provides automatic retries with DLQ for permanent failures.
- **Attachment support out of the box** — attachments stored in S3, referenced by the email payload. No manual S3 setup needed.
- **Delivery logging** — every sent email is tracked in DynamoDB with timestamp, recipient, status, and metadata. This fills a gap SES does not cover — there is no native "sent log" in SES.
- **EventBridge notifications** — emits events on send, bounce, and complaint. Consumers can react (update user records, trigger alerts) without coupling to the email service internals.
- **Simple SDK** — a type-safe client that makes sending an email a single function call. You provide the content (HTML, plain text, or both — optionally via a template), recipients, and data. The service handles queuing, attachment resolution, and delivery.
- **Transparent and auditable** — open source, you can read exactly how emails are composed, queued, and delivered. No black box.

## Rationale

### 1. Reliability through SQS

Direct SES calls from application code are fragile — Lambda timeouts, concurrency limits, and transient SES errors can all silently drop emails. An SQS queue decouples "intent to send" from "actual delivery," providing at-least-once guarantees and DLQ for investigation.

### 2. No built-in sent log in SES

SES tells you about bounces and complaints via SNS notifications, but there's no way to query "what emails did I send in the last 24 hours?" without building your own tracking. This package provides that out of the box.

### 3. Attachments are a common need with non-trivial setup

Sending a PDF receipt or CSV export requires S3 storage, presigned URLs or inline encoding, MIME construction, and size limit awareness. This is handled once in the package rather than reimplemented per project.

### 4. Simple API hides operational complexity

The consuming application calls `emailService.send(...)` with recipients and content (HTML string, plain text, or both). Behind that call: the message is queued to SQS, a consumer Lambda picks it up, resolves attachments from S3, calls SES, logs the result to DynamoDB, and emits an EventBridge event. The consumer doesn't need to know or manage any of this.

### 5. Future: email dashboard

SES provides no UI for browsing sent emails. A future addition to this package will provide a dashboard showing the log of sent emails, delivery status, bounce/complaint history — something that currently requires third-party services (Postmark, SendGrid) and doesn't exist in the AWS ecosystem.

## Consequences

- Requires SES to be configured (verified domain, out of sandbox for production). This is unavoidable with any SES-based solution.
- Adds SQS + DLQ + consumer Lambda + DynamoDB table to the infrastructure. Acceptable because these are all serverless/pay-per-use and the operational benefits outweigh the resource count.
- Optionally supports React Email templates (pre-built at deploy time to avoid bundling React in Lambda), but templating is not required — you can send plain HTML, plain text, or both directly. The service is agnostic about how you produce your email content.
- The package is opinionated about AWS — not portable to other cloud providers. Acceptable given the target audience.

## Alternatives Considered

### Use SES directly from application code

Rejected. No retry guarantees, no delivery logging, no attachment management, no bounce handling infrastructure. Every project would need to build these independently.

### Use a managed email service (SendGrid, Postmark, Mailgun)

Rejected. External vendor dependency, per-email pricing at scale, data leaves your AWS account. These services are excellent but unnecessary when you already have SES and want full control.

### Use SNS for email

Rejected. SNS email is for notifications, not transactional email. No HTML support, no attachments, no templates, limited formatting.
