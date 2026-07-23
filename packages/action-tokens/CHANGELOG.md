# @beesolve/action-tokens

## 0.5.1

### Patch Changes

- f1e4fc9: Improve documentation: rewrite READMEs for clarity, add ADR documents, and reorganize docs structure.

## 0.5.0

### Minor Changes

- ff131ea: Date fields (`expiresAt`, `createdAt`, `startedAt`, `updatedAt`) are now ISO timestamp strings instead of `Date` objects. Use `Date.parse(value)` for comparisons or `new Date(value)` to convert.

  Migrate from Biome to Oxlint + Oxfmt. Add `@beesolve/lint-config` with custom rules. Replace `T[]` with `Array<T>` syntax. Add typeguards to lambda-fetch-api authorizer.

## 0.4.0

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

## 0.3.0

### Minor Changes

- 5628db5: - Add `createNewWithThrottling` method — atomic transactional write of token + throttle record. Throws `TokenThrottledError` if cooldown window has not elapsed.
  - Add `peek` method — read-only token inspection without decrementing `remainingUses`.
  - Export `TokenThrottledError` class.

## 0.2.0

### Minor Changes

- d425826: Add `@beesolve/action-tokens` package — a generic one-time action token store backed by AWS DynamoDB.
  - **CDK construct** (`/cdk`): provisions a DynamoDB TableV2 with a GSI on `(value, action)`, TTL on `expiresAt`, and a `grantAccess` method that wires IAM permissions and environment variables into any Lambda function.
  - **SDK client** (`/sdk`): Lambda-ready client that reads env vars injected by `grantAccess` and creates a DynamoDB DocumentClient automatically.
  - **Domain model** (`/model`): `createNew`, `use`, and `drain` operations with optimistic concurrency via DynamoDB `ConditionExpression`, brute-force protection (wrong values still consume a use), and application-level expiry enforcement to close the DynamoDB TTL race window.
  - **Typed errors**: `TokenDoesNotExistError`, `TokenAlreadyExistsError`, `ExpiredTokenError`, `TokenAlreadyUsedUpError`, `TokenInvalidError`, `MalformedTokenError`, `UnexpectedError`.
