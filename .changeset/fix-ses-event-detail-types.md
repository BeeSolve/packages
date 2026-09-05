---
"@beesolve/email-service": patch
---

Fix the SES `detail-type` values in `@beesolve/email-service/events` to match the event names AWS SES actually publishes to EventBridge. The delivery, bounce, complaint, send, and reject schemas previously matched `"SES Delivery"`, `"SES Bounce"`, `"SES Complaint"`, `"SES Message Sent"`, and `"SES Reject"`, which never occur — SES emits `"Email Delivered"`, `"Email Bounced"`, `"Email Complaint"`, `"Email Sent"`, and `"Email Rejected"`. As a result `parseEmailEvent` returned `null` for every SES event and consumers silently dropped all delivery/bounce/complaint/reject/send notifications. The schemas now use the correct `detail-type` literals so these events parse and are processed. Additionally, `mail.headers` and `mail.commonHeaders` are now optional, since SES does not always populate them (e.g. a templated Send event before the subject is rendered).
