# Consuming auth events

`@beesolve/auth-service` publishes all events to EventBridge. The typical wiring is:

```
EventBridge → SQS queue → Lambda (your consumer)
```

Or for simple cases:

```
EventBridge → Lambda (directly)
```

## CDK wiring (EventBridge → SQS → Lambda)

```ts
import { SqsHandler } from "@beesolve/sqs-handler/cdk";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";

const consumer = new SqsHandler(this, "AuthConsumer", {
  entry: `${__dirname}/consumer.ts`,
  handler: "consumer.handler",
});

new Rule(this, "AuthRule", {
  eventPattern: {
    source: ["beesolve.auth.api"],
    detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
  },
  targets: [new SqsQueue(consumer.queue)],
});
```

## CDK wiring (EventBridge → Lambda directly)

For simpler cases where you don't need SQS retry/DLQ semantics:

```ts
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";

new Rule(this, "AuthRule", {
  eventPattern: {
    source: ["beesolve.auth.api"],
    detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
  },
  targets: [new LambdaFunction(consumer)],
});
```

## Typed handler with `@beesolve/auth-service/events`

Instead of parsing raw JSON and casting to `any`, import the typed helpers:

```ts
import type { SQSEvent } from "aws-lambda";
import {
  isEmailCodeAuth,
  isUnsuccessfulAuth,
  isSessionInvalidated,
  parseAuthEvent,
} from "@beesolve/auth-service/events";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const authEvent = parseAuthEvent(record.body);
    if (authEvent == null) continue; // not a recognised auth event — skip

    if (isEmailCodeAuth(authEvent)) {
      const {
        emailAddress,
        code,
        expiresAt,
        accountId,
        referenceCode,
        baseUri,
        acceptLanguage,
        requestOrigin,
        cookies,
      } = authEvent.detail;

      // Send the OTP email using @beesolve/email-service or any provider
      await sendVerificationEmail({ to: emailAddress, code, referenceCode, expiresAt });
    }

    if (isUnsuccessfulAuth(authEvent)) {
      const { emailAddress, reason } = authEvent.detail;
      console.warn(`Failed sign-in for ${emailAddress}: ${reason}`);
    }

    if (isSessionInvalidated(authEvent)) {
      const { sessionId } = authEvent.detail;
      // Invalidate downstream caches if needed
    }
  }
};
```

`parseAuthEvent` returns `null` for unknown or malformed records, so the loop safely skips events from other sources on the same bus.

## Locale detection

The `EmailCodeAuth` event includes signals for sending the OTP email in the user's preferred language:

### 1. `cookies` (user-set preference)

If your app stores a locale preference in a cookie (e.g. `locale=fr`), it will be present in the `cookies` map (all cookies except `__Host-SID` and `__Host-DataToken` are forwarded):

```ts
const locale = authEvent.detail.cookies["locale"] ?? null;
```

### 2. `requestOrigin` (subdomain or domain)

If your app is hosted on locale-specific domains (e.g. `fr.example.com`), the `Origin` header value is available for locale resolution.

### 3. `acceptLanguage` (browser preference)

The raw `Accept-Language` header value, e.g. `"fr-FR,fr;q=0.9,en;q=0.8"`. Pass this to your i18n library for resolution.

## Available events

| `detail-type`          | Type guard               | Fired when                                |
| ---------------------- | ------------------------ | ----------------------------------------- |
| `EmailCodeAuth`        | `isEmailCodeAuth`        | Sign-in requested or code resent          |
| `EmailAddressVerified` | `isEmailAddressVerified` | New account created on first sign-in      |
| `DataToken`            | `isDataToken`            | Sign-in complete with `dataToken` enabled |
| `SuccessfulAuth`       | `isSuccessfulAuth`       | Sign-in succeeded                         |
| `UnsuccessfulAuth`     | `isUnsuccessfulAuth`     | Sign-in failed (invalid/expired code)     |
| `SessionInvalidated`   | `isSessionInvalidated`   | Sign out                                  |
| `EmailInvitation`      | `isEmailInvitation`      | _(reserved)_                              |
