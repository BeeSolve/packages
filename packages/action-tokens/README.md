# @beesolve/action-tokens

Generic one-time action token store backed by AWS DynamoDB.

- Single-table design with `(owner, action)` primary key and a `(value, action)` GSI
- Remaining-use counter decremented atomically on each attempt (including invalid ones)
- TTL-based automatic cleanup — no cron required
- Optional per-identity throttling via `createNewWithThrottling`
- CDK construct with `grantAccess` that wires IAM + env vars in one call
- Works with `@beesolve/auth-service` for sign-in codes, email verification, and magic links

## What This Is

A low-level building block for any short-lived, single-use (or limited-use) credential flow: email verification codes, magic login links, password reset tokens, OTP challenges, QR code scans. It handles storage, expiry, use-counting, and brute-force protection — you bring your own token generation and delivery logic.

## What This Is NOT

- **Not an auth framework** — it stores and validates tokens; it does not send emails, render UIs, or manage sessions.
- **Not a rate limiter** — `createNewWithThrottling` prevents rapid token re-creation for a single identity, but it is not a general-purpose rate-limiting solution.
- **Not multi-region** — the DynamoDB table is single-region. Use DynamoDB global tables externally if you need replication.

## Installation

```sh
npm install @beesolve/action-tokens
```

```sh
bun add @beesolve/action-tokens
```

## CDK Setup

Import from `@beesolve/action-tokens/cdk`. Call `grantAccess` on each Lambda that needs token operations — it grants IAM read/write and injects `BEESOLVE_ACTION_TOKENS_TABLE_NAME` and `BEESOLVE_ACTION_TOKENS_INDEX_NAME` as environment variables.

```ts
import { ActionTokens } from "@beesolve/action-tokens/cdk";
import { RemovalPolicy } from "aws-cdk-lib";

const tokens = new ActionTokens(this, "ActionTokens", {
  removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  deletionProtection: isProd, // defaults to true when removalPolicy is RETAIN
  pointInTimeRecoveryEnabled: isProd, // defaults to true when deletionProtection is true
  encryptionKey: myKmsKey, // optional, defaults to AWS-managed encryption
  contributorInsights: isProd, // optional, defaults to false
});

tokens.grantAccess(myLambdaFunction);
```

### CDK Props

| Prop                         | Type            | Default                                    |
| ---------------------------- | --------------- | ------------------------------------------ |
| `removalPolicy`              | `RemovalPolicy` | `RETAIN`                                   |
| `deletionProtection`         | `boolean`       | `true` when `removalPolicy` is `RETAIN`    |
| `pointInTimeRecoveryEnabled` | `boolean`       | `true` when `deletionProtection` is `true` |
| `encryptionKey`              | `IKey`          | `undefined` (AWS-managed encryption)       |
| `contributorInsights`        | `boolean`       | `false`                                    |

## Usage

### SDK client (Lambda handlers)

Import from `@beesolve/action-tokens/sdk`. The client reads the env vars injected by `grantAccess` at module load time — if they are missing, it throws immediately at cold start.

```ts
import { ActionTokensClient } from "@beesolve/action-tokens/sdk";

const tokens = new ActionTokensClient();
```

You can also pass your own `DynamoDBDocumentClient`:

```ts
const tokens = new ActionTokensClient({ dynamoDbClient: myDocClient });
```

### Create a token

```ts
const token = await tokens.createNew({
  owner: "user-123",
  action: "verify-email",
  value: String(Math.floor(100000 + Math.random() * 900000)), // 6-digit OTP
  remainingUses: 5, // max attempts before lockout
  expiresAt: new Date(Date.now() + 10 * 60_000), // 10 minutes
  data: { emailAddress: "user@example.com" }, // arbitrary metadata
  overwrite: false, // throw if token already exists
});
```

### Create a token with throttling

Atomically writes the token and a throttle record. If the identity already has a non-expired throttle record for this action, throws `TokenThrottledError`.

```ts
import { TokenThrottledError } from "@beesolve/action-tokens/model";

try {
  const token = await tokens.createNewWithThrottling({
    owner: "session-abc",
    action: "signInRequest",
    value: code,
    remainingUses: 3,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    data: { emailAddress },
    overwrite: true,
    throttle: {
      id: emailAddress, // identity to throttle (e.g., email)
      windowSeconds: 60, // minimum gap between creations
    },
  });
} catch (error) {
  if (error instanceof TokenThrottledError) {
    // Called again before the 60s window elapsed — return 429 to the client
    return new Response("Too many requests", { status: 429 });
  }
  throw error;
}
```

### Use (validate) a token

```ts
import {
  TokenDoesNotExistError,
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
  TokenInvalidError,
} from "@beesolve/action-tokens/model";

try {
  const used = await tokens.use({
    owner: "user-123", // omit to look up by (value, action) via GSI
    action: "verify-email",
    value: submittedCode,
    drainWhenValid: false, // true → zero out remaining uses atomically
  });

  console.log("verified:", used.data?.emailAddress);
} catch (error) {
  if (error instanceof TokenDoesNotExistError) {
    /* not found */
  }
  if (error instanceof ExpiredTokenError) {
    /* past expiresAt */
  }
  if (error instanceof TokenAlreadyUsedUpError) {
    /* remainingUses is 0 */
  }
  if (error instanceof TokenInvalidError) {
    /* wrong value (use was still consumed) */
  }
}
```

### Peek (read without consuming)

```ts
const token = await tokens.peek({ owner: "user-123", action: "verify-email" });
// Throws TokenDoesNotExistError, ExpiredTokenError, or TokenAlreadyUsedUpError
```

### Drain (delete immediately)

```ts
await tokens.drain({ owner: "user-123", action: "verify-email" });
```

### Direct model usage (advanced)

Import from `@beesolve/action-tokens/model` when you want to supply your own DynamoDB client or skip the env-var machinery.

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

## Local Development

Tests use mocked DynamoDB calls — no real AWS resources needed:

```sh
bun test
```

## Caveats & Constraints

- **Incorrect values still consume a use.** This is intentional brute-force protection. An attacker cannot enumerate values without burning through `remainingUses`.
- **GSI lookups are eventually consistent.** When `owner` is omitted in `use()`, the query goes through the GSI which does not support strongly consistent reads. Provide `owner` when you have it.
- **TTL cleanup is not instant.** DynamoDB deletes expired items within minutes, not immediately. Application code checks `expiresAt` before the TTL sweep runs, so expired tokens are rejected in real-time.
- **One token per `(owner, action)` pair.** If you need multiple concurrent tokens for the same owner and purpose, use distinct `action` values (e.g., `verify-email:attempt-1`).
- **Throttle records share the same table.** They use the key pattern `owner: "throttle#<id>"` and are cleaned up by TTL like regular tokens.

## Troubleshooting

| Problem                                                                        | Cause                                                                                       | Fix                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Lambda crashes at cold start with "ActionTokens has not been set up correctly" | Missing env vars `BEESOLVE_ACTION_TOKENS_TABLE_NAME` or `BEESOLVE_ACTION_TOKENS_INDEX_NAME` | Call `tokens.grantAccess(fn)` in your CDK stack and redeploy           |
| `TokenAlreadyExistsError` when creating                                        | A token for this `(owner, action)` already exists and `overwrite` is `false`                | Set `overwrite: true` or `drain` the old token first                   |
| `TokenThrottledError` on `createNewWithThrottling`                             | A non-expired throttle record exists for this identity + action                             | Wait for the throttle window to pass, or use a different throttle `id` |
| `UnexpectedError: Token was modified concurrently`                             | Another process modified the token between the read and the update                          | Retry the `use()` call — the conditional check ensures correctness     |

## FAQ

**Why does an incorrect value still consume a use?**

Intentional brute-force protection. If incorrect values were free, an attacker could enumerate all possibilities without limit.

**What is `drainWhenValid` for?**

It atomically sets `remainingUses` to `0` when the value matches, ensuring no concurrent caller can squeeze in another use. Use it for single-use flows (magic links, email verification) where a token must be consumed exactly once.

**Can I look up a token without knowing the owner?**

Yes — omit `owner` in `use()`. The call uses the GSI to query by `(value, action)`. This works for magic-link clicks where the owner is not yet known.

**Why both a primary key and a GSI lookup in `use()`?**

The primary key path (`owner` + `action`) is strongly consistent. The GSI path (`value` + `action`) is eventually consistent but does not require knowing the owner upfront. Provide `owner` when available for the stronger guarantee.

## Package Exports

| Export path                     | Entry point     | Description                                                    |
| ------------------------------- | --------------- | -------------------------------------------------------------- |
| `@beesolve/action-tokens/cdk`   | `dist/cdk.js`   | CDK construct (`ActionTokens`) with `grantAccess`              |
| `@beesolve/action-tokens/sdk`   | `dist/sdk.js`   | `ActionTokensClient` — reads env vars, creates DynamoDB client |
| `@beesolve/action-tokens/model` | `dist/model.js` | `ActionTokens` class + all error types — BYO DynamoDB client   |
