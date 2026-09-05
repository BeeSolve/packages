---
"@beesolve/email-service": patch
---

Tighten the `@beesolve/email-service/events` parse contract. All seven event schemas (`EmailSentSuccess`, `EmailSentFailure`, `SES Delivery`, `SES Bounce`, `SES Complaint`, `SES Message Sent`, `SES Reject`) now require a top-level `id: string` (the EventBridge event id, usable as an idempotency key), and `EmailSentSuccess` now carries the full `request` payload in `detail`. The `is*` type guards validate against these schemas via `v.is(...)` rather than checking `detail-type` alone, so a malformed event no longer narrows to a typed event.
