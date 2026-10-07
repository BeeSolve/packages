# How to: Handle Token Errors

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify

Every token operation throws typed errors on failure. Validating a submitted token with
`use()` can produce several distinct outcomes, and each maps to a different response for
the client. This guide shows a complete pattern that handles all of them.

## Prerequisites

- Action tokens already wired via the CDK construct (see [Getting Started](./getting-started.md))

## Error types

All error types are exported from `@beesolve/action-tokens/model` and extend a common base.

| Error                     | When it is thrown                                              |
| ------------------------- | -------------------------------------------------------------- |
| `TokenDoesNotExistError`  | No token matches the `(owner, action)` or `(value, action)`    |
| `ExpiredTokenError`       | The token exists but is past `expiresAt`                       |
| `TokenAlreadyUsedUpError` | `remainingUses` has reached `0`                                |
| `TokenInvalidError`       | Wrong value - note the attempt still consumed a use            |
| `TokenThrottledError`     | A non-expired throttle record blocks `createNewWithThrottling` |

## Steps

### 1. Import the error types you handle

```ts
import {
  TokenDoesNotExistError,
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
  TokenInvalidError,
} from "@beesolve/action-tokens/model";
```

### 2. Wrap the `use()` call

Handle each error distinctly. `TokenInvalidError` is thrown after the use is consumed, so
report how many attempts remain where it matters.

```ts
try {
  const used = await tokens.use({
    owner: "user-123",
    action: "verify-email",
    value: submittedCode,
    drainWhenValid: true,
  });

  return new Response(JSON.stringify({ emailAddress: used.data?.emailAddress }), {
    status: 200,
  });
} catch (error) {
  if (error instanceof TokenDoesNotExistError) {
    return new Response("No such token", { status: 404 });
  }
  if (error instanceof ExpiredTokenError) {
    return new Response("Token expired, request a new one", { status: 410 });
  }
  if (error instanceof TokenAlreadyUsedUpError) {
    return new Response("Too many attempts, request a new one", { status: 429 });
  }
  if (error instanceof TokenInvalidError) {
    return new Response("Incorrect code", { status: 400 });
  }
  throw error;
}
```

### 3. Handle throttling at creation time

`TokenThrottledError` comes from `createNewWithThrottling`, not `use()`. It carries an
optional `retryAfterSeconds`. See [Throttling](./throttling.md) for the full pattern.

## Common Pitfalls

- Catching a broad `Error` loses the distinction between "wrong code" and "expired" - the
  client cannot tell the user what to do next. Branch on the specific types.
- Re-throw anything that is not a known token error. A caught-and-swallowed
  `UnexpectedError` (concurrent modification) hides real data problems.

## See Also

- [How to: Get started](./getting-started.md)
- [How to: Throttle token creation](./throttling.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify)
