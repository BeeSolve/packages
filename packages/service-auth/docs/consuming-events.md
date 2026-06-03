# Consuming auth events

`@beesolve/auth-service` publishes all events to EventBridge. The typical wiring is:

```
EventBridge → SQS queue → Lambda (your consumer)
```

## CDK wiring

```ts
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";

new Rule(this, "AuthRule", {
  eventBus,
  eventPattern: { source: ["beesolve.auth.api"] },
  targets: [new SqsQueue(queue)],
});
```

## Typed handler with `@beesolve/auth-service/events`

Instead of parsing raw JSON and casting to `any`, import the typed helpers:

```ts
import type { SQSEvent } from "aws-lambda";
import {
  isEmailCodeAuth,
  isSessionInvalidated,
  parseAuthEvent,
} from "@beesolve/auth-service/events";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const authEvent = parseAuthEvent(record.body);
    if (authEvent == null) continue; // not an auth event — skip

    if (isEmailCodeAuth(authEvent)) {
      const {
        emailAddress,
        code,
        expiresAt,
        accountId,
        baseUri,
        acceptLanguage,
        requestOrigin,
        cookies,
      } = authEvent.detail; // fully typed, no `any`

      // send the OTP email …
    }

    if (isSessionInvalidated(authEvent)) {
      const { sessionId } = authEvent.detail;
      // invalidate downstream caches …
    }
  }
};
```

`parseAuthEvent` returns `null` for unknown or malformed records, so the loop safely skips events from other sources on the same bus (e.g. `aws.ses`).

## Locale detection

The primary use for locale signals in `EmailCodeAuthDetail` is sending the OTP email in the user's preferred language. The `EmailCodeAuth` event is the integration point for email delivery — your consumer is responsible for rendering and dispatching the email. [`@beesolve/service-email`](../../../service-email) is the companion package that handles AWS SES delivery and pairs naturally with this package.

Three signals are available on `EmailCodeAuthDetail`, in priority order:

### 1. `cookies` (user-set preference)

If your app stores a locale preference in a cookie (e.g. `locale=fr`), it will be present in the `cookies` map (all cookies except `__Host-SID` and `__Host-DataToken` are forwarded):

```ts
const locale = authEvent.detail.cookies["locale"] ?? null;
```

### 2. `requestOrigin` (subdomain or domain)

The browser always sends an `Origin` header on cross-origin requests. If your app is hosted on locale-specific domains or subdomains (e.g. `fr.example.com`), the value can be passed to [Paraglide.js](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) or any locale-routing library for resolution.

```
https://fr.example.com  →  locale: "fr"
```

### 3. `acceptLanguage` (browser preference)

The raw `Accept-Language` header value, e.g. `"fr-FR,fr;q=0.9,en;q=0.8"`. This can be passed directly to Paraglide.js or a similar library — no manual parsing needed.

## Available events

| `detail-type`          | Type guard               | Fired when                                |
| ---------------------- | ------------------------ | ----------------------------------------- |
| `EmailCodeAuth`        | `isEmailCodeAuth`        | Sign-in requested — send the OTP email    |
| `EmailAddressVerified` | `isEmailAddressVerified` | New account created on first sign-in      |
| `DataToken`            | `isDataToken`            | Sign-in complete with `dataToken` enabled |
| `SuccessfulAuth`       | `isSuccessfulAuth`       | _(reserved)_                              |
| `UnsuccessfulAuth`     | `isUnsuccessfulAuth`     | _(reserved)_                              |
| `SessionInvalidated`   | `isSessionInvalidated`   | Sign out                                  |
| `EmailInvitation`      | `isEmailInvitation`      | _(reserved)_                              |
