# How to: Throttle Token Creation

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify

`createNewWithThrottling` prevents a single identity from rapidly re-requesting tokens
(for example, hammering a "resend code" button). It writes the token and a throttle
record in one atomic transaction - if the identity already has a non-expired throttle
record for the same action, nothing is persisted and `TokenThrottledError` is thrown.

## Prerequisites

- Action tokens already wired via the CDK construct (see [Getting Started](./getting-started.md))
- An identity to throttle on (email address, phone number, account id, etc.)

## Steps

### 1. Call `createNewWithThrottling`

The `throttle.id` is the identity to limit, and `throttle.windowSeconds` is the minimum
gap between creations for that identity + action.

```ts
import { TokenThrottledError } from "@beesolve/action-tokens/model";

try {
  await tokens.createNewWithThrottling({
    owner: sessionToken,
    action: "signInRequest",
    value: code,
    remainingUses: 3,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    data: { emailAddress },
    overwrite: true,
    throttle: { id: emailAddress, windowSeconds: 60 },
  });
} catch (error) {
  if (error instanceof TokenThrottledError) {
    return new Response("Too many requests", {
      status: 429,
      headers: error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined,
    });
  }
  throw error;
}
```

### 2. Use `retryAfterSeconds` for the client

`TokenThrottledError` carries `retryAfterSeconds` - the seconds remaining until the
throttle window expires. Surface it as a `Retry-After` header or a countdown in the UI.

## Throttle identity vs. window

- **Identity (`throttle.id`)** is what you limit. Throttle on the stable, user-facing
  identifier (email address), not on the per-request `owner` token - otherwise every
  fresh request generates a new owner and bypasses the limit.
- **Window (`throttle.windowSeconds`)** is the cooldown. The throttle record is stored
  with a TTL equal to the window, so it self-expires and shares the same table as tokens.

## How service-auth uses this internally

`@beesolve/auth-service` calls `createNewWithThrottling` in its `signInRequest` and
`resendCode` handlers. It throttles on the submitted `emailAddress` with a configurable
`resendCooldownSeconds` window, while the token `owner` is a fresh random value per
request. This is why a resend-code button cannot be used to spam a mailbox.

```ts
await actionTokens.createNewWithThrottling({
  action: "signInRequest",
  owner: token,
  value: code,
  remainingUses: 3,
  expiresAt,
  data: { emailAddress, accountId: account?.id ?? null },
  overwrite: true,
  throttle: { id: emailAddress, windowSeconds: resendCooldownSeconds },
});
```

## Common Pitfalls

- Throttling on `owner` instead of a stable identity defeats the limit entirely.
- `createNewWithThrottling` is not a general-purpose rate limiter - it only gates token
  re-creation for one identity + action pair.

## See Also

- [How to: Get started](./getting-started.md)
- [How to: Handle token errors](./error-handling.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify)
