# How to: Get started with cdk-email-alarms

> Full source: https://github.com/BeeSolve/packages/tree/main/packages/cdk-email-alarms

## Prerequisites

- A CDK app (`aws-cdk-lib` + `constructs`)
- An email address to receive alarm notifications (SNS confirms the subscription by email)

## Steps

### 1. Install

```sh
bun add @beesolve/cdk-email-alarms
```

```sh
npm install @beesolve/cdk-email-alarms
```

### 2. Create the construct

```ts
import { EmailAlarms } from "@beesolve/cdk-email-alarms";

const alarms = new EmailAlarms(this, "Alarms", {
  emailAddress: "ops@example.com",
});
```

### 3. Alarm on Lambda errors

Triggers when a function has one or more errors in an evaluation period, and
sends both ALARM and OK notifications.

```ts
alarms.reportLambdaErrors(myHandler);
```

### 4. Alarm on SQS queue health

Always alarms when the DLQ has messages, and optionally when the queue sees no
messages or no consumers for a given period.

```ts
import { Duration } from "aws-cdk-lib";

alarms.reportSqsErrors({
  queue: myQueue,
  dlq: myDlq,
  noMessagesPeriod: Duration.hours(1),
  noConsumersPeriod: Duration.hours(1),
});
```

## Common Pitfalls

- SNS email subscriptions require confirmation — click the link in the confirmation email or alarms will not reach you.
- `noMessagesPeriod` and `noConsumersPeriod` are optional; omit them to alarm only on DLQ messages.

## See Also

- [README](../../README.md) — construct props and the full alarm API
