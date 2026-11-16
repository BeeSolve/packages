# @beesolve/cdk-email-alarms

CDK construct that creates CloudWatch alarms with email notifications via SNS. Supports Lambda error alarms and SQS queue health alarms.

## Installation

```bash
npm install @beesolve/cdk-email-alarms
```

Peer dependency: `aws-cdk-lib` and `constructs`.

## Usage

```ts
import { EmailAlarms } from "@beesolve/cdk-email-alarms";

const alarms = new EmailAlarms(this, "Alarms", {
  emailAddress: "ops@example.com",
});
```

### Lambda error alarms

Triggers when a Lambda function has ≥1 error in an evaluation period. Sends both ALARM and OK notifications.

```ts
const handler = new Function(this, "Handler", {/* ... */});

alarms.reportLambdaErrors(handler);
```

### SQS queue alarms

Monitors a queue + dead-letter queue pair. Always alarms when the DLQ has messages. Optionally alarms when the queue receives no messages or has no consumers for a given period.

```ts
import { Duration } from "aws-cdk-lib";

alarms.reportSqsErrors({
  queue: myQueue,
  dlq: myDlq,
  noMessagesPeriod: Duration.hours(1), // optional: alarm if no messages for 1 hour
  noConsumersPeriod: Duration.hours(1), // optional: alarm if no consumers for 1 hour
});
```

## API

### `new EmailAlarms(scope, id, props)`

| Prop           | Type     | Description                                  |
| -------------- | -------- | -------------------------------------------- |
| `emailAddress` | `string` | Email address to receive alarm notifications |

### `alarms.reportLambdaErrors(handler)`

Creates an SNS topic + CloudWatch alarm on the function's error metric. Sends notifications on state transitions (ALARM → OK and OK → ALARM).

### `alarms.reportSqsErrors(props)`

| Prop                | Type       | Description                                                    |
| ------------------- | ---------- | -------------------------------------------------------------- |
| `queue`             | `Queue`    | The SQS queue to monitor                                       |
| `dlq`               | `Queue`    | The dead-letter queue                                          |
| `noMessagesPeriod`  | `Duration` | Optional. Alarm if no messages arrive within this period       |
| `noConsumersPeriod` | `Duration` | Optional. Alarm if no messages are consumed within this period |

## License

[MIT](../../LICENSE)
