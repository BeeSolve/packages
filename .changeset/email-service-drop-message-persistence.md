---
"@beesolve/email-service": minor
---

Remove DynamoDB message persistence from the email service. The sent-log role is now owned by `@beesolve/email-service-dashboard`, which projects this service's EventBridge lifecycle events into its own DynamoDB table and stores request bodies in its own S3 bucket — so the email service no longer needs to persist anything itself.

The CDK construct no longer provisions the `EmailLog` DynamoDB table and drops the now-unused props `messagesRetentionDays`, `isProd`, `removalPolicy`, and `deletionProtection`. The handler no longer writes send records to DynamoDB, and the SDK drops the `getMessage` method along with the `BEESOLVE_EMAILS_TABLE_NAME` env var. EventBridge (`EmailSentSuccess` / `EmailSentFailure`) is now the single integration point for observing sends. See `docs/adr-002-drop-dynamodb-message-persistence.md`.
