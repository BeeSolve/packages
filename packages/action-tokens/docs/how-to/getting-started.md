# How to: Get Started with Action Tokens

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify

Store, validate, and expire short-lived single-use tokens (email verification codes,
magic links, OTP challenges) backed by DynamoDB. This guide covers wiring the CDK
construct, granting a Lambda access, and creating then validating a first token.

## Prerequisites

- An AWS CDK app (`aws-cdk-lib` v2)
- A Lambda `Function` that will create or validate tokens
- AWS credentials configured for deployment

## Steps

### 1. Install

```sh
bun add @beesolve/action-tokens
```

```sh
npm install @beesolve/action-tokens
```

### 2. Add the CDK construct and grant access

Import from `@beesolve/action-tokens/cdk`. `grantAccess` wires IAM read/write and
injects the `BEESOLVE_ACTION_TOKENS_TABLE_NAME` and `BEESOLVE_ACTION_TOKENS_INDEX_NAME`
environment variables onto the Lambda in one call.

```ts
import { ActionTokens } from "@beesolve/action-tokens/cdk";
import { RemovalPolicy } from "aws-cdk-lib";

const tokens = new ActionTokens(this, "ActionTokens", {
  removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  deletionProtection: isProd,
});

tokens.grantAccess(myLambdaFunction);
```

### 3. Create a token in your handler

Construct the SDK client once at module load. It reads the injected env vars at cold
start and throws immediately if the construct was not wired.

```ts
import { ActionTokensClient } from "@beesolve/action-tokens/sdk";

const tokens = new ActionTokensClient();

const token = await tokens.createNew({
  owner: "user-123",
  action: "verify-email",
  value: String(Math.floor(100000 + Math.random() * 900000)),
  remainingUses: 5,
  expiresAt: new Date(Date.now() + 10 * 60_000),
  data: { emailAddress: "user@example.com" },
  overwrite: false,
});
```

### 4. Validate the token

`use` decrements `remainingUses` atomically on every attempt, including invalid ones.
Set `drainWhenValid: true` to zero out remaining uses when the value matches, for
exactly-once flows.

```ts
const used = await tokens.use({
  owner: "user-123",
  action: "verify-email",
  value: submittedCode,
  drainWhenValid: true,
});

console.log("verified:", used.data?.emailAddress);
```

Omit `owner` to look a token up by `(value, action)` through the GSI - useful for
magic-link clicks where the owner is not yet known.

## Common Pitfalls

- Forgetting `tokens.grantAccess(fn)` causes the Lambda to crash at cold start with
  "ActionTokens has not been set up correctly". The SDK client parses its env vars eagerly.
- Incorrect values still consume a use. This is intentional brute-force protection, not a bug.
- GSI lookups (omitting `owner`) are eventually consistent. Pass `owner` when you have it.

## See Also

- [How to: Throttle token creation](./throttling.md)
- [How to: Handle token errors](./error-handling.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify)
