# @beesolve/action-tokens

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
