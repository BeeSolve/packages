---
"@beesolve/email-service": minor
---

Add `replyToAddresses` support to `sendEmail`. Reply-to addresses are passed through to SES as `ReplyToAddresses` and, unlike the sender, do not need to be verified in SES.
