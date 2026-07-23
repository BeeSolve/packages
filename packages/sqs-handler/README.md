# @beesolve/sqs-handler

Type-safe SQS task queue with automatic partial batch failure handling and a CDK construct for deployment.

- Define async task functions in TypeScript — get a type-safe client to enqueue them
- Partial batch failure reporting out of the box (only failed messages retry)
- Supports both standard and FIFO queues
- CDK construct provisions queue + DLQ + Lambda with sane defaults
- Multiple queue configurations (e.g. short tasks vs long-running) from a single definition
- Optional KMS encryption for queues
- `localInvocation` mode for development without SQS

## What This Is

A thin wrapper around SQS that gives you two things:

1. **A Lambda handler** that deserializes SQS messages, routes them to your functions, and reports partial batch failures.
2. **A typed client** that enqueues calls to those same functions — no manual JSON serialization or queue URL management.

The CDK construct (`SqsHandler`) wires up the Lambda, SQS queue, DLQ, alarms, and environment variables automatically.

## What This Is NOT

- Not a general-purpose job scheduler or workflow engine
- Not a replacement for Step Functions — there's no orchestration, retries with backoff, or chaining
- Not usable outside AWS Lambda (the handler expects `SQSEvent` from the Lambda runtime)

## Installation

```bash
npm i @beesolve/sqs-handler
```

```bash
bun add @beesolve/sqs-handler
```

## CDK Setup

```ts
import { Duration } from "aws-cdk-lib";
import { SqsHandler } from "@beesolve/sqs-handler/cdk";

const sqsHandler = new SqsHandler(stack, "Tasks", {
  handlerProps: {
    entry: resolve("src/lib/server/tasks.ts"),
    memorySize: 1024,
    timeout: Duration.seconds(30),
    // reservedConcurrentExecutions defaults to 2
  },
  // Optional: additional handler configurations with different timeouts
  additionalConfigurations: {
    longRunning: { timeout: Duration.minutes(15) },
  },
  // Optional: FIFO queue settings
  queueProps: { fifo: true },
  // Optional: email alarms for queue errors
  alarms,
  // Optional: customer-managed KMS encryption
  encryptionKey: myKmsKey,
});

// Grant other Lambdas permission to enqueue tasks
sqsHandler.grantAccess(apiHandler);

// Add environment variables or permissions to all task handlers
sqsHandler.forEachHandler((handler) => {
  myTable.grantReadWriteData(handler);
});
```

### `SqsHandlerProps`

| Prop                                        | Type                                                     | Required | Description                                                      |
| ------------------------------------------- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `handlerProps`                              | `Nodejs24FunctionProps & { memorySize, timeout, entry }` | Yes      | Lambda configuration. `entry` points to your tasks file.         |
| `handlerProps.reservedConcurrentExecutions` | `number`                                                 | No       | Defaults to `2`.                                                 |
| `additionalConfigurations`                  | `Record<string, { memorySize?, timeout? }>`              | No       | Extra queue+handler pairs with different resource limits.        |
| `queueProps`                                | `SqsWithDlqLambdaInputProps` (minus `lambda`)            | No       | Forwarded to `SqsWithDlq` (e.g. FIFO settings).                  |
| `alarms`                                    | `EmailAlarms`                                            | No       | From `@beesolve/cdk-email-alarms`. Adds SQS/DLQ alarm reporting. |
| `encryptionKey`                             | `IKey`                                                   | No       | KMS key for server-side encryption of all queues.                |

### Environment Variables Injected

The construct automatically injects these into both the task handler and any Lambda passed to `grantAccess`:

| Variable                               | Value                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `BEESOLVE_TASKS_MAIN_QUEUE_URL`        | URL of the main queue                                                  |
| `BEESOLVE_TASKS_ADDITIONAL_QUEUE_URLS` | JSON object mapping additional configuration names to their queue URLs |

## Usage

### Define task functions

```ts
// src/lib/server/tasks.ts
import { createSqsHandlers } from "@beesolve/sqs-handler";
import { SQSClient } from "@aws-sdk/client-sqs";

export const [handler, tasks] = createSqsHandlers({
  fifo: false, // standard queue (no deduplicationId/groupId options)
  sqsClient: new SQSClient(),
  queueUrls: {
    main: process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL!,
  },
  functions: {
    sendWelcomeEmail: async (userId: string) => {
      // your logic here
    },
    processUpload: async (fileKey: string, metadata: { size: number }) => {
      // your logic here
    },
  },
});
```

### Enqueue a task from another Lambda

```ts
import { tasks } from "./tasks";

// Type-safe — arguments must match the function signature
await tasks.sendWelcomeEmail("user-123");
await tasks.processUpload("uploads/file.png", { size: 4096 });
```

### FIFO queue with deduplication

```ts
export const [handler, tasks] = createSqsHandlers({
  fifo: true,
  sqsClient: new SQSClient(),
  queueUrls: {
    main: process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL!,
  },
  functions: {
    syncUser: async (userId: string) => {
      // ...
    },
  },
});

// FIFO queues accept an options argument after the function params
await tasks.syncUser("user-123", {
  deduplicationId: "sync-user-123",
  groupId: "user-123",
});
```

### Multiple queues with routing

```ts
export const [handler, tasks] = createSqsHandlers({
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: {
    main: process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL!,
    longRunning: "https://sqs.eu-west-1.amazonaws.com/123/long-running",
  },
  // Route specific functions to non-main queues by default
  queueUrlOverride: {
    processVideo: "longRunning",
  },
  functions: {
    sendEmail: async (to: string) => {},
    processVideo: async (key: string) => {}, // always goes to longRunning queue
  },
});
```

### Local development

Use `localInvocation: true` to bypass SQS and invoke functions directly (synchronously, fire-and-forget):

```ts
export const [handler, tasks] = createSqsHandlers({
  localInvocation: true, // calls function directly, skips SQS
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: { main: "" },
  functions: {
    myTask: async (data: string) => {
      console.log(data);
    },
  },
});

tasks.myTask("hello"); // invokes immediately without sending to SQS
```

## Caveats & Constraints

- **Sequential processing**: Records within a single invocation are processed sequentially (not in parallel). This keeps error isolation simple but limits throughput per invocation.
- **No return values**: Task functions must return `void`. Results cannot be sent back to the caller.
- **Argument serialization**: Arguments are JSON-serialized via `encodeToStringifiable`/`decodeFromStringifiable` from `@beesolve/helpers`. Non-serializable values (functions, symbols, circular references) will fail.
- **SQS message size limit**: Total serialized message body must be under 256 KB.
- **Reserved concurrency**: The CDK construct defaults to `reservedConcurrentExecutions: 2`. Increase this for high-throughput queues.
- **Environment variable names**: The construct uses `BEESOLVE_TASKS_MAIN_QUEUE_URL` and `BEESOLVE_TASKS_ADDITIONAL_QUEUE_URLS` — these are hardcoded.

## Troubleshooting

**Messages going to DLQ immediately**

The handler validates message format with Valibot. Messages must have `{ fn: string, args: any[] }` structure. If you're sending messages manually (not via the typed client), ensure the format matches.

**"Unknown function" errors in logs**

The function name in the message doesn't match any key in `functions`. This can happen if you rename a function while messages are still in the queue from the old version.

**Tasks not executing (no errors, no logs)**

Check that `grantAccess` was called for the Lambda that enqueues tasks. Without it, the enqueuing Lambda won't have the queue URL environment variable or SendMessage permission.

**`localInvocation` not awaiting the function**

By design, `localInvocation` calls the function without awaiting it. This matches the fire-and-forget semantics of SQS. Errors in local mode won't propagate to the caller.

## Package Exports

| Export Path                 | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `@beesolve/sqs-handler`     | `createSqsHandlers` — runtime handler + typed client factory |
| `@beesolve/sqs-handler/cdk` | `SqsHandler` construct + `SqsHandlerProps` interface         |
