# @beesolve/action-tokens

A generic one-time action token store backed by AWS DynamoDB. Use it to implement email verification codes, magic login links, password reset tokens, OTP flows, or any other short-lived single-use credential.

## Purpose

Action tokens associate a secret value with an owner and an action. Each token has a remaining-use counter and an expiry time. Calling `use()` validates the token and decrements the counter; once it reaches zero the token is blocked. DynamoDB's TTL attribute handles automatic cleanup after expiry — no cron job needed.

Tokens are looked up either by `(owner, action)` as a consistent primary-key read, or by `(value, action)` via a Global Secondary Index when the owner is unknown at call time (e.g. a magic-link click).

## Installation

```sh
npm install @beesolve/action-tokens
# or
bun add @beesolve/action-tokens
```

## Usage

### 1 — Infrastructure (CDK)

Import from `@beesolve/action-tokens/cdk` and add the construct to your stack. Call `grantAccess` on each Lambda that needs to interact with tokens — it sets the required IAM permissions and environment variables automatically.

```ts
import { ActionTokens } from "@beesolve/action-tokens/cdk";

const tokens = new ActionTokens(this, "ActionTokens", {
  // Enable point-in-time recovery in production
  pointInTimeRecoveryEnabled: isProd,
  // Protect the table from accidental deletion in production
  deletionProtection: isProd,
  removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  // Optional: customer-managed KMS encryption
  encryptionKey: myKmsKey,
  // Optional: CloudWatch Contributor Insights for access pattern monitoring
  contributorInsights: isProd,
});

// Grants read/write access and injects env vars into the Lambda
tokens.grantAccess(myLambdaFunction);
```

#### Default behaviors

| Prop | Default |
|---|---|
| `removalPolicy` | `RETAIN` |
| `deletionProtection` | `true` when `removalPolicy` is `RETAIN` |
| `pointInTimeRecoveryEnabled` | `true` when `deletionProtection` is `true` |
| `contributorInsights` | `false` |
| `encryptionKey` | `undefined` (AWS-managed encryption) |

### 2 — Lambda handler (SDK)

Import from `@beesolve/action-tokens/sdk`. The client reads the environment variables injected by `grantAccess` and creates a DynamoDB client automatically.

> **Prerequisite**: the Lambda must have been granted access via `grantAccess` before deploying. The module-level env parse will throw at startup if `BEESOLVE_ACTION_TOKENS_TABLE_NAME` or `BEESOLVE_ACTION_TOKENS_INDEX_NAME` are missing.

```ts
import { ActionTokensClient } from "@beesolve/action-tokens/sdk";

const tokens = new ActionTokensClient();
```

### 3 — Token lifecycle

**Create a token**

```ts
import { ActionTokensClient, TokenAlreadyExistsError } from "@beesolve/action-tokens/sdk";
import { randomBytes } from "crypto";

const tokens = new ActionTokensClient();

const token = await tokens.createNew({
  owner: "user-123",
  action: "verify-email",
  value: String(Math.floor(100000 + Math.random() * 900000)), // 6-digit OTP
  remainingUses: 5,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  data: { emailAddress: "user@example.com" },
  overwrite: false, // throw TokenAlreadyExistsError if a token already exists
});
```

**Use a token**

```ts
import {
  TokenDoesNotExistError,
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
} from "@beesolve/action-tokens/model";

try {
  const used = await tokens.use({
    owner: "user-123",  // omit to look up by value alone (GSI path)
    action: "verify-email",
    value: submittedCode,
    drainWhenValid: false, // set true to zero out remaining uses in one step
  });

  // token.data contains whatever was stored at creation time
  console.log("verified email:", used.data?.emailAddress);
} catch (error) {
  if (error instanceof TokenDoesNotExistError) { /* token not found */ }
  if (error instanceof ExpiredTokenError)      { /* token has expired */ }
  if (error instanceof TokenAlreadyUsedUpError){ /* no uses remaining */ }
  if (error instanceof Error && error.message === "Token is invalid.") {
    /* value did not match */
  }
}
```

**Drain a token**

Deletes the token immediately, regardless of remaining uses. Useful for explicit invalidation (e.g. on sign-out or after a successful one-time action).

```ts
await tokens.drain({ owner: "user-123", action: "verify-email" });
```

### 4 — Direct model usage (advanced)

Import from `@beesolve/action-tokens/model` when you want to supply your own DynamoDB client or manage infrastructure yourself.

```ts
import { ActionTokens } from "@beesolve/action-tokens/model";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const tokens = new ActionTokens({
  dynamo,
  tableName: process.env.MY_TABLE_NAME!,
  valueIndexName: process.env.MY_INDEX_NAME!,
});
```

## API

### `createNew(props)`

Creates a new token. Throws `TokenAlreadyExistsError` if a token with the same `(owner, action)` already exists and `overwrite` is `false`.

| Prop | Type | Description |
|---|---|---|
| `owner` | `string` | Identifies who owns the token (e.g. a user ID) |
| `action` | `string` | Identifies the purpose of the token (e.g. `"verify-email"`) |
| `value` | `string` | The secret that must be presented when calling `use()` |
| `remainingUses` | `number` | How many times the token can be used before being blocked |
| `expiresAt` | `Date` | When the token expires |
| `data` | `Record<string, unknown> \| undefined` | Arbitrary metadata stored with the token |
| `overwrite` | `boolean` | Replace an existing `(owner, action)` token if one exists |

### `use(props)`

Validates and consumes one use of the token. Throws if the token does not exist, is expired, or has no remaining uses. An incorrect `value` still decrements the use counter (see FAQ).

Returns the updated token.

| Prop | Type | Description |
|---|---|---|
| `owner` | `string \| undefined` | If provided, fetches by `(owner, action)` with a consistent read. If omitted, fetches by `(value, action)` via the GSI |
| `action` | `string` | |
| `value` | `string` | The secret to validate |
| `drainWhenValid` | `boolean` | If `true` and the value is correct, sets `remainingUses` to `0` atomically |

### `drain(props)`

Deletes the token unconditionally.

### Error types (from `@beesolve/action-tokens/model`)

| Class | Thrown when |
|---|---|
| `TokenDoesNotExistError` | Token not found |
| `TokenAlreadyExistsError` | `createNew` called with `overwrite: false` and a token already exists |
| `ExpiredTokenError` | Token has passed its `expiresAt` |
| `TokenAlreadyUsedUpError` | `remainingUses` is already `0` |
| `MalformedTokenError` | Item in DynamoDB does not match the expected schema |
| `UnexpectedError` | Unexpected state (e.g. index corruption) |

## FAQ

**Why does an incorrect value still consume a use?**

Intentional. If guessing the wrong value did not cost a use, an attacker could enumerate values at no cost until finding the correct one. Charging a use for every attempt — regardless of correctness — limits brute-force attempts to `remainingUses` tries.

**What happens when a token expires in DynamoDB?**

DynamoDB's TTL attribute (`expiresAt`) automatically deletes the item within a few minutes of expiry. `use()` also checks `expiresAt` in application code before the TTL cleanup runs, so expired tokens are rejected immediately rather than waiting for DynamoDB to remove them.

**What is `drainWhenValid` for?**

It atomically sets `remainingUses` to `0` in the same UpdateCommand that records the use, ensuring no concurrent caller can squeeze in another use after you've validated. Use it for single-use flows (email verification, magic links) where you want to guarantee the token is used exactly once even under concurrent requests.

**Can I look up a token without knowing the owner?**

Yes — omit `owner` in `use()`. The call falls back to a GSI query by `(value, action)`. This is useful for magic-link clicks where the token value arrives in the URL but the owner identity hasn't been established yet.

**Why is there both a primary key lookup and a GSI lookup in `use()`?**

The primary key lookup (`owner` + `action`) is a strongly consistent read, preferred when the caller already knows the owner. The GSI lookup (`value` + `action`) is eventually consistent but allows lookup without the owner — necessary for flows like magic links or QR code scans. Provide `owner` whenever you have it to get the stronger consistency guarantee.

**Can I store the same action for multiple owners?**

Yes. The table's primary key is `(owner, action)`, so each owner can have an independent token per action.
