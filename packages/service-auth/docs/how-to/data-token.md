# How to: Data token - anonymous-to-authenticated handoff

> Full working example (event consumer wiring): https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithEmail

The data token feature lets you carry anonymous-session data across the sign-in boundary. The canonical use case is linking an anonymous shopping cart (or any pre-auth state) to a newly authenticated account.

## How it works

1. Before the user signs in, your app creates an anonymous session and stores its identifier in a `__Host-DataToken` cookie.
2. When the user completes sign-in, the auth service reads that cookie and fires a `DataToken` EventBridge event containing the account ID and the raw token value.
3. Your event consumer receives the event and merges the anonymous data into the authenticated account.

## Enabling the feature

Set `dataToken: true` on the CDK construct:

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";

const auth = new AuthGateway(this, "Auth", {
  stage: "prod",
  frontendUri: "https://app.example.com",
  allowSignUp: true,
  dataToken: true, // ← enable
});
```

This instructs the auth Lambda to read `__Host-DataToken` on every `signInComplete` call.

## Setting the cookie (server side)

Write the cookie before the user initiates sign-in. Use the `toDataTokenCookie` helper which sets `__Host-` prefix, `Secure`, `SameSite=Strict`, `HttpOnly`, and `Path=/`:

```ts
import { toDataTokenCookie } from "@beesolve/auth-service";

const token = generateAnonymousSessionId(); // your own ID
const setCookie = toDataTokenCookie(token); // Max-Age 900s (15 min) by default
response.headers.append("Set-Cookie", setCookie);
```

Store your anonymous state server-side keyed by `token`.

Custom max age:

```ts
const setCookie = toDataTokenCookie(token, 1800); // 30 minutes
```

## Consuming the `DataToken` event

```ts
import { isDataToken, parseAuthEvent } from "@beesolve/auth-service/events";
import type { SQSEvent } from "aws-lambda";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const authEvent = parseAuthEvent(record.body);
    if (authEvent == null) continue;

    if (isDataToken(authEvent)) {
      const { accountId, emailAddress, dataToken } = authEvent.detail;
      // Merge anonymous data into the authenticated account
      await mergeCart({ anonymousToken: dataToken, accountId });
    }
  }
};
```

## `DataTokenDetail` shape

| Field          | Type     | Description                                    |
| -------------- | -------- | ---------------------------------------------- |
| `accountId`    | `string` | The authenticated account ID                   |
| `emailAddress` | `string` | The authenticated email address                |
| `dataToken`    | `string` | The raw value of the `__Host-DataToken` cookie |

## Security notes

- `__Host-DataToken` is `HttpOnly` — it cannot be read by JavaScript, only forwarded by the browser.
- The token value is opaque to the auth service; it is forwarded as-is. Your consumer is responsible for validating it against your own anonymous-session store.
- The cookie `Max-Age` defaults to 900 seconds (15 minutes). Pass a custom value to `toDataTokenCookie(token, maxAge)` if you need a longer window.
- Once the `DataToken` event fires, you should clear the anonymous session to prevent reuse.

## Common Pitfalls

- **Forgetting `dataToken: true`.** The auth Lambda only reads `__Host-DataToken` and emits the `DataToken` event when the construct is created with `dataToken: true`. Without it, the cookie is ignored.
- **Setting the cookie after sign-in starts.** Write `__Host-DataToken` before the user initiates sign-in - it is read on `signInComplete`, so a cookie set too late never reaches the event.
- **Trusting the token blindly.** The value is opaque to the auth service and merely forwarded. Validate it against your own anonymous-session store before merging data.

## See Also

- [Consuming auth events](./consuming-events.md) - general event consumer wiring
- [Getting Started](./getting-started.md) - minimal end-to-end setup
- [Full event-consumer example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithEmail)
