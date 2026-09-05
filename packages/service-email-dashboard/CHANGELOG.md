# @beesolve/email-service-dashboard

## 0.1.1

### Patch Changes

- 22f3dce: Fix the users page returning a 500. `Users.listAll()` queries the `reverse` GSI and validates each item against the full user schema (`email`, `type`, `createdAt`), but the index projected only the message/recipient stats attributes, so those fields were missing and every user record failed validation with "Malformed stored user record". The `reverse` GSI now also projects `email`, `type`, and `createdAt`.

  Note: applying this requires DynamoDB to recreate the `reverse` GSI (projection changes are not in-place), during which the index is briefly unavailable while it backfills.

  Also widened the email event consumer's `commonHeaderString` helper to tolerate SES events that omit `mail.commonHeaders`.

- Updated dependencies [b827446]
- Updated dependencies [22f3dce]
  - @beesolve/email-service@0.4.1

## 0.1.0

### Minor Changes

- Add `@beesolve/email-service-dashboard` — a prebuilt kit-on-lambda SvelteKit dashboard for viewing `@beesolve/email-service` delivery status. It ships a single `./cdk` construct (`EmailServiceDashboard`) that provisions the SSR Lambda behind CloudFront, wires `@beesolve/auth-service` email-code auth, provisions its own OTP `Emails`, and runs an event-ingest Lambda that projects the email delivery lifecycle (from EventBridge) into its own DynamoDB table — giving the UI durable, queryable message, status, and aggregate-stats data.
