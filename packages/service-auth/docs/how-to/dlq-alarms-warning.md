# How to: Resolve the "No alarms configured" warning

> Base CDK stack to extend: https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple

When you synth or deploy a stack that uses `AuthGateway` or `AuthService` without passing the `alarms` prop, CDK prints a warning:

```
WARNING No alarms configured. DLQ messages (failed session invalidations) will go unnoticed. Pass `alarms` to enable monitoring. (Construct Annotations)
   <stack>/<path>/Auth
   Acknowledge with 'Annotation::@beesolve/auth-service:noAlarms'
```

## What it means

The construct creates a dead-letter queue (DLQ) for the SDK handler. If a session invalidation fails (for example during sign-out or impersonation teardown), the failed message lands in that DLQ. Without an alarm watching the DLQ, those failures accumulate silently - nobody is notified.

The warning is a [CDK construct annotation](https://docs.aws.amazon.com/cdk/v2/guide/aspects.html) raised with `Annotations.addWarningV2`. It does not block the deploy; it only reminds you that DLQ monitoring is not wired up. You have two ways to resolve it.

## Option 1: Enable monitoring (recommended)

Pass an [`@beesolve/cdk-email-alarms`](https://github.com/BeeSolve/packages/tree/main/packages/cdk-email-alarms) `EmailAlarms` instance as `alarms`. The construct then alarms on the DLQ and emails you when a message arrives.

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { EmailAlarms } from "@beesolve/cdk-email-alarms";

const alarms = new EmailAlarms(this, "Alarms", {
  emailAddress: "alerts@example.com",
});

const auth = new AuthGateway(this, "Auth", {
  stage: "prod",
  frontendUri: "https://app.example.com",
  allowSignUp: true,
  // highlight-next-line
  alarms,
});
```

The warning disappears once `alarms` is provided. This is the right choice for any production stack - a failed session invalidation is a security-relevant event you want to know about.

## Option 2: Acknowledge the warning

If you deliberately do not want DLQ monitoring on a given stack (for example a throwaway dev or preview environment), suppress the annotation by its ID so it stops appearing on every synth:

```ts
import { Annotations } from "aws-cdk-lib";

const auth = new AuthGateway(this, "Auth", {
  stage: "dev",
  frontendUri: "https://dev.example.com",
  allowSignUp: true,
  // no `alarms` on purpose
});

// highlight-next-line
Annotations.of(auth).acknowledgeWarning("@beesolve/auth-service:noAlarms");
```

The acknowledgement ID is `@beesolve/auth-service:noAlarms` - the same ID shown in the warning output after `Annotation::`. You can scope the acknowledgement to the `AuthGateway`/`AuthService` construct (as above), to a stack, or to the whole app - any ancestor of the construct that raised it. `acknowledgeWarning` also accepts an optional second argument with a reason string that is recorded in the metadata.

## Common Pitfalls

- **Acknowledging in production to silence the noise.** The warning exists because unmonitored session-invalidation failures are easy to miss. Prefer Option 1 for anything user-facing; reserve Option 2 for disposable environments.
- **Acknowledging on the wrong scope.** `acknowledgeWarning` only suppresses warnings raised on the construct it is called on **or its descendants**. Calling it on an unrelated sibling construct has no effect - target the `Auth` construct, its stack, or the app.
- **Using the wrong ID.** The ID must match exactly, including the `@beesolve/auth-service:` prefix. The part after `Annotation::` in the warning output is the ID to pass; do not include the `Annotation::` prefix itself.
- **Expecting the warning to fail the build.** It is a warning, not an error, so `cdk deploy` proceeds regardless. If you run synth with `--strict` (warnings treated as errors) in CI, an un-acknowledged warning will fail the build - which is often exactly why you reach for Option 2.

## See Also

- [Getting Started](./getting-started.md) - the base stack this extends
- [Consuming Events](./consuming-events.md) - reacting to auth events, including failures
- [`@beesolve/cdk-email-alarms` on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/cdk-email-alarms)
