# Data token — anonymous-to-authenticated handoff

The data token feature lets you carry anonymous-session data across the sign-in boundary. The canonical use case is linking an anonymous shopping cart (or any pre-auth state) to a newly authenticated account.

## How it works

1. Before the user signs in, your app creates an anonymous session and stores its identifier in a `__Host-DataToken` cookie.
2. When the user completes sign-in, the auth service reads that cookie and fires a `DataToken` EventBridge event containing the account ID and the raw token value.
3. Your event consumer receives the event and merges the anonymous data into the authenticated account.

## Enabling the feature

Set `dataToken: true` on the CDK construct:

```ts
import { Auth } from "@beesolve/auth-service/cdk";

const auth = new Auth(this, "Auth", {
  stage: "prod",
  frontendUri: "https://app.example.com",
  allowSignUp: true,
  dataToken: true, // ← enable
});
```

This instructs the auth Lambda to read `__Host-DataToken` on every `signInComplete` call.

## Setting the cookie (client side)

Write the cookie before the user initiates sign-in. The cookie must use the `__Host-` prefix and match the security constraints the auth service expects (`Secure`, `SameSite=Lax`, `HttpOnly`):

```ts
// server-side helper (e.g. in your SSR framework's middleware)
import { toDataTokenCookie } from "@beesolve/auth-service";

const token = generateAnonymousSessionId(); // your own ID
const setCookie = toDataTokenCookie(token);  // Max-Age 900 by default
response.headers.append("Set-Cookie", setCookie);
```

Store your anonymous state server-side keyed by `token`.

## Consuming the `DataToken` event

```ts
import { isDataToken, parseAuthEvent } from "@beesolve/auth-service/events";
import type { SQSEvent } from "aws-lambda";

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const authEvent = parseAuthEvent(record.body);

    if (isDataToken(authEvent)) {
      const { accountId, emailAddress, dataToken } = authEvent.detail;
      // merge anonymous data into accountId
      await mergeCart({ anonymousToken: dataToken, accountId });
    }
  }
};
```

## `DataTokenDetail` shape

| Field | Type | Description |
|---|---|---|
| `accountId` | `string` | The authenticated account ID |
| `emailAddress` | `string` | The authenticated email address |
| `dataToken` | `string` | The raw value of the `__Host-DataToken` cookie |

## Security notes

- `__Host-DataToken` is `HttpOnly` — it cannot be read by JavaScript, only forwarded by the browser.
- The token value is opaque to the auth service; it is forwarded as-is. Your consumer is responsible for validating it against your own anonymous-session store.
- The cookie `Max-Age` defaults to 900 seconds (15 minutes). Pass a custom value to `toDataTokenCookie(token, maxAge)` if you need a longer window.
- Once the `DataToken` event fires, you should clear the anonymous session to prevent reuse.
