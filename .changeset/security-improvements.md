---
"@beesolve/cdk-constructs": minor
"@beesolve/sqs-handler": minor
"@beesolve/action-tokens": minor
"@beesolve/auth-service": minor
---

Add optional `encryptionKey` prop for customer-managed KMS encryption on all data-at-rest resources (DynamoDB tables and SQS queues).

**@beesolve/cdk-constructs**
- `SqsWithDlq`: add `encryptionKey?: IKey` — uses KMS encryption when provided
- `Nodejs24Function`: add VPC + DynamoDB Gateway Endpoint documentation

**@beesolve/sqs-handler**
- `SqsHandler`: add `encryptionKey?: IKey` — forwarded to SQS queues

**@beesolve/action-tokens**
- Add `encryptionKey?: IKey` for customer-managed table encryption
- Add `contributorInsights?: boolean` for CloudWatch Contributor Insights
- Default `deletionProtection` to `true` when `removalPolicy` is `RETAIN`
- Default `pointInTimeRecoveryEnabled` to `true` when `deletionProtection` is `true`

**@beesolve/auth-service**
- Add `encryptionKey?: IKey` applied to all tables and SQS queues
- Add `contributorInsights?: boolean` (default `true` in prod)
- Add `accessLogging?: boolean` for HTTP API access logs (default `true` in prod)
- Add `authorizerReservedConcurrency?: number`
- Add `sdkHandlerReservedConcurrency?: number`
- Add CDK warning when `alarms` is not provided
