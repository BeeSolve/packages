---
"@beesolve/action-tokens": minor
---

Add `@beesolve/action-tokens` package — a generic one-time action token store backed by AWS DynamoDB.

- **CDK construct** (`/cdk`): provisions a DynamoDB TableV2 with a GSI on `(value, action)`, TTL on `expiresAt`, and a `grantAccess` method that wires IAM permissions and environment variables into any Lambda function.
- **SDK client** (`/sdk`): Lambda-ready client that reads env vars injected by `grantAccess` and creates a DynamoDB DocumentClient automatically.
- **Domain model** (`/model`): `createNew`, `use`, and `drain` operations with optimistic concurrency via DynamoDB `ConditionExpression`, brute-force protection (wrong values still consume a use), and application-level expiry enforcement to close the DynamoDB TTL race window.
- **Typed errors**: `TokenDoesNotExistError`, `TokenAlreadyExistsError`, `ExpiredTokenError`, `TokenAlreadyUsedUpError`, `TokenInvalidError`, `MalformedTokenError`, `UnexpectedError`.
