---
"@beesolve/email-service": minor
---

Add `./events` entry point, templating helpers, and documentation.

**New: `@beesolve/email-service/events`**

Typed EventBridge event types and runtime helpers for both event sources the email service emits:

- `beesolve.email.api` — `EmailSentSuccess`, `EmailSentFailure`
- `aws.ses` — `SES Delivery`, `SES Bounce`, `SES Complaint`, `SES Message Sent`, `SES Reject`

All types are derived from valibot schemas. `parseEmailEvent(body)` safely parses and validates an SQS record body; `is*` type guards narrow the union type in handlers.

**New: `hydrateTemplate()` in `@beesolve/email-service/templating`**

Replaces `$$$__KEY__$$$` placeholder tokens in pre-built HTML/text with runtime values. Pairs with the pre-build pattern to keep React out of the Lambda bundle.

**New: `buildTemplates()` in `@beesolve/email-service/templating`**

Build-time helper that discovers React template components in a directory, renders each with all requested locales, and writes `<name>_<locale>.json` files. Eliminates the need to hand-write the build script in every consuming package.
