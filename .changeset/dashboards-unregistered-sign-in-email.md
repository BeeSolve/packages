---
"@beesolve/dmarc-dashboard": minor
"@beesolve/email-service-dashboard": minor
---

Send a notification email on an unregistered sign-in attempt.

The auth-events consumer now reacts to `UnsuccessfulAuth` events with `code: "emailNotRegistered"` (emitted by `@beesolve/auth-service` when a sign-in is completed for an address that has no account while sign-up is disabled) by emailing the attempted address to tell them someone tried to sign in with their email and that they should contact an administrator. Other `UnsuccessfulAuth` reasons continue to be logged only.
