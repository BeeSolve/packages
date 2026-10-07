# How to: Error Handling and the Dead-Letter Queue

> No dedicated sample exists for this package yet. See the GitHub repository for source: https://github.com/BeeSolve/packages/tree/main/packages/sqs-handler

The handler reports partial batch failures so only failed messages retry. Messages that keep failing are moved to a dead-letter queue (DLQ) that the `SqsHandler` construct provisions automatically.

## Prerequisites

- A deployed `SqsHandler` construct (see [Getting Started](./getting-started.md))

## How failures flow

### 1. Partial batch failures

The handler processes each record sequentially. If a task function throws, that record's `messageId` is added to `batchItemFailures` and the error is logged; the remaining records in the batch still run. The handler returns the standard partial-batch-failure shape:

```ts
{
  batchItemFailures: [{ itemIdentifier: "<messageId>" }];
}
```

The construct enables `reportBatchItemFailures` on the event source, so only the reported messages become visible again for retry. Successful messages in the same batch are deleted and never reprocessed.

### 2. Retry behavior

A failed message returns to the queue and is redelivered after the visibility timeout. The construct sets the queue visibility timeout to 6× the Lambda `timeout` (capped at 12 hours), giving each attempt room to finish before redelivery.

### 3. The dead-letter queue

The queue has a redrive policy with `maxReceiveCount: 5`. After a message fails 5 delivery attempts it is moved to the DLQ instead of retrying forever. Both the main queue and the DLQ retain messages for 14 days.

## Inspecting failed messages

Messages in the DLQ keep the original JSON body (`{ fn, args }`). Read them from the AWS console or CLI to see which function failed and with what arguments:

```bash
aws sqs receive-message --queue-url "$DLQ_URL" --max-number-of-messages 10
```

## Monitoring failures

Pass an `EmailAlarms` instance (from `@beesolve/cdk-email-alarms`) as `alarms`. The construct calls `reportSqsErrors` on each queue, adding CloudWatch alarms for the main queue and DLQ:

```ts
import { SqsHandler } from "@beesolve/sqs-handler/cdk";

new SqsHandler(stack, "Tasks", {
  handlerProps: { entry, memorySize: 1024, timeout },
  alarms,
});
```

## Common Pitfalls

- **Messages hit the DLQ immediately on arrival.** The body did not match the expected `{ fn: string, args: any[] }` shape, so validation threw before any task ran. This happens when enqueuing manually instead of through the typed `tasks` client.
- **`"Unknown function"` in logs.** The message references a function name no longer present in `functions` - usually a renamed function with old messages still queued.
- **Non-serializable arguments.** Arguments are serialized via `encodeToStringifiable`; functions, symbols, and circular references fail and the record is sent to retry.
- **`localInvocation` swallows errors.** In local mode the function is invoked fire-and-forget without awaiting, so thrown errors do not propagate and nothing goes to a DLQ.

## See Also

- [Getting Started](./getting-started.md)
- [README](../../README.md) - troubleshooting and constraints
