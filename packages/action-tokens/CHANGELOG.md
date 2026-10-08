# @beesolve/action-tokens

## 0.5.5

### Patch Changes

- b7cfa56: Use constant-time comparison (`crypto.timingSafeEqual`) when verifying secrets to remove a timing side-channel.

  - `@beesolve/hmac`: `HmacSigner.isValidSignature` now compares the decoded signature bytes in constant time instead of using `===`. This also hardens `ensureValidUrl` (signed URL verification), which routes through it.
  - `@beesolve/action-tokens`: `ActionTokens.use` now compares the token value in constant time instead of using `===`.

  No API changes; behaviour is identical for matching and non-matching inputs.

## 0.5.4

### Patch Changes

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

## 0.5.3

### Patch Changes

- b7c6890: `TokenThrottledError` now carries `retryAfterSeconds`, the number of seconds until the throttle window clears.

  When `createNewWithThrottling` is rejected by an active throttle, the error exposes `retryAfterSeconds` (computed from the existing throttle record's `expiresAt`), so callers can surface an accurate retry delay. The field is `undefined` when the remaining window cannot be determined.

## 0.5.2

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects

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
