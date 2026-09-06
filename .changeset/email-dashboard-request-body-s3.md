---
"@beesolve/email-service-dashboard": minor
---

Store the full email request on the dashboard's own S3 bucket (keyed `messages/<messageId>.json`) when the `EmailSentSuccess` event is consumed, and show it on demand in a modal on the message detail page.

The message body is now fetched only when the user clicks "Request message body" (via a dedicated form action) and rendered as JSON in a dialog. This removes the previous dependency on the `@beesolve/email-service` SDK `getMessage` call from the dashboard's request path — the dashboard and email service stay decoupled through EventBridge, and the dashboard no longer needs a second email-service SDK instance to read message bodies.
