# @beesolve/sqs-handler

## 0.2.1

### Patch Changes

- f1e4fc9: Improve documentation: rewrite READMEs for clarity, add ADR documents, and reorganize docs structure.

## 0.2.0

### Minor Changes

- c2bd8aa: Add optional `encryptionKey` prop for customer-managed KMS encryption on all data-at-rest resources (DynamoDB tables and SQS queues).

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

### Patch Changes

- Updated dependencies [c2bd8aa]
  - @beesolve/cdk-constructs@0.2.0

## 0.1.22

### Patch Changes

- d0a811d: fix test imports to use each package's public index instead of internal `src/` paths
- Updated dependencies [d0a811d]
  - @beesolve/helpers@0.1.6

## 0.1.21

### Patch Changes

- adf27f3: throw explicitly on unknown function name instead of silently no-oping
- Updated dependencies [adf27f3]
  - @beesolve/cdk-email-alarms@0.1.4
