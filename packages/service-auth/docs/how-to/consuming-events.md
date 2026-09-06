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
  eventBus: auth.eventBus,
  eventPattern: {
    source: [auth.eventSource],
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
  eventBus: auth.eventBus,
  eventPattern: {
    source: [auth.eventSource],
    detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
  },
  targets: [new LambdaFunction(consumer)],
});
```

## Isolating multiple apps on a shared account

By default every auth deployment publishes to the `default` EventBridge bus with
source `beesolve.auth.api`. If two apps deploy their own consumer rules matching
that source on the same bus, a sign-in for one app triggers **both** consumers —
so a user logging into one app receives an OTP email from every app. There are
two supported ways to isolate them; pick one (or combine them).

### Option 1 — separate event bus (no new package version required)

Give one app its own EventBridge bus and point both its publisher and its
consumer rule at that bus. Events never reach rules on another bus, regardless of
source. This works with the existing `eventBusArn` prop, and the construct
exposes the resolved bus as `auth.eventBus` so consumer rules bind to the right
one automatically:

```ts
import { EventBus, Rule } from "aws-cdk-lib/aws-events";

const bus = new EventBus(this, "AuthBus");

const auth = new AuthGateway(this, "Auth", {
  stage,
  frontendUri,
  allowSignUp: true,
  eventBusArn: bus.eventBusArn, // publish here instead of "default"
});

// Bind the consumer rule to the same bus. Prefer `auth.eventBus` over a literal
// so the rule follows the deployment's configured bus.
new Rule(this, "AuthRule", {
  eventBus: auth.eventBus,
  eventPattern: {
    source: [auth.eventSource],
    detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
  },
  targets: [new LambdaFunction(consumer)],
});
```

Strongest isolation and available today. The trade-off is an extra bus to manage
and the requirement that the consumer `Rule` is bound to that bus (`{ eventBus }`).

> **SES caveat.** Only auth events (published via `EventBridge.putEvents`) can be
> moved to a custom bus. SES delivery/bounce/complaint events (`aws.ses`), emitted
> via `@beesolve/email-service`, can only be routed to the account **`default`**
> bus — SES configuration-set event destinations do not support custom buses.
> Consumers of those events must keep their rule on the default bus. This is why,
> for example, `EmailServiceDashboard` binds its auth rule to `auth.eventBus` but
> keeps its email-events rule on `default`.

### Option 2 — distinct `source` via `appId`

Keep the shared bus but give each app a distinct source. Set `appId` on the auth
construct — the event source becomes `beesolve.auth.<appId>` — and match the
construct's resolved `eventSource` field in the consumer rule so publisher and
consumer never drift:

```ts
const auth = new AuthGateway(this, "Auth", {
  stage,
  frontendUri,
  allowSignUp: true,
  appId: "bewatr", // source => "beesolve.auth.bewatr"
});

new Rule(this, "AuthRule", {
  eventBus: auth.eventBus,
  eventPattern: {
    source: [auth.eventSource], // resolved from appId: "beesolve.auth.bewatr"
    detailType: ["EmailCodeAuth", "UnsuccessfulAuth"],
  },
  targets: [new LambdaFunction(consumer)],
});
```

The bundled `EmailServiceDashboard` and `DmarcDashboard` constructs already
subscribe to `props.auth.eventSource` (and bind to `props.auth.eventBus`), so they
follow whatever `appId`/bus the auth deployment uses without extra wiring. `appId`
is the only knob — the source string is computed once by the construct; there is
no helper to import and no source string to hand-build.

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
