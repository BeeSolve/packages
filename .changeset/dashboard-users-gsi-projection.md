---
"@beesolve/email-service-dashboard": patch
---

Fix the users page returning a 500. `Users.listAll()` queries the `reverse` GSI and validates each item against the full user schema (`email`, `type`, `createdAt`), but the index projected only the message/recipient stats attributes, so those fields were missing and every user record failed validation with "Malformed stored user record". The `reverse` GSI now also projects `email`, `type`, and `createdAt`.

Note: applying this requires DynamoDB to recreate the `reverse` GSI (projection changes are not in-place), during which the index is briefly unavailable while it backfills.

Also widened the email event consumer's `commonHeaderString` helper to tolerate SES events that omit `mail.commonHeaders`.
