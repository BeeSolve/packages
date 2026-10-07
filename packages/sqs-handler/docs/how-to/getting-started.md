# How to: Get Started with @beesolve/sqs-handler

> No dedicated sample exists for this package yet. See the GitHub repository for source: https://github.com/BeeSolve/packages/tree/main/packages/sqs-handler

Define async task functions in TypeScript, deploy them with the `SqsHandler` CDK construct, and enqueue them from other Lambdas with a fully typed client. The construct provisions the queue, a dead-letter queue, the handler Lambda, and the required environment variables.

## Prerequisites

- An AWS CDK app (`aws-cdk-lib` + `constructs`)
- A Lambda-based project using the Nodejs runtime
- Node.js 24+

## Steps

### 1. Install

```bash
bun add @beesolve/sqs-handler
```

```bash
npm i @beesolve/sqs-handler
```

### 2. Define your task functions

Create the file that your handler Lambda bundles. `createSqsHandlers` returns a tuple: the Lambda `handler` and a typed `tasks` client used to enqueue work.

```ts
// src/lib/server/tasks.ts
import { SQSClient } from "@aws-sdk/client-sqs";
import { createSqsHandlers } from "@beesolve/sqs-handler";

export const [handler, tasks] = createSqsHandlers({
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: {
    main: process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL!,
  },
  functions: {
    sendWelcomeEmail: async (userId: string) => {
      // your logic here
    },
  },
});
```

### 3. Deploy with the CDK construct

`SqsHandler` wires the queue, DLQ, and handler Lambda. Point `entry` at the file from step 2.

```ts
import { SqsHandler } from "@beesolve/sqs-handler/cdk";
import { Duration } from "aws-cdk-lib";

const sqsHandler = new SqsHandler(stack, "Tasks", {
  handlerProps: {
    entry: resolve("src/lib/server/tasks.ts"),
    memorySize: 1024,
    timeout: Duration.seconds(30),
  },
});
```

### 4. Grant enqueue access to another Lambda

Any Lambda that enqueues tasks needs the queue URL env vars and SendMessage permission. `grantAccess` injects both.

```ts
sqsHandler.grantAccess(apiHandler);
```

### 5. Enqueue a task

Import the `tasks` client in the enqueuing Lambda. Calls are type-checked against each function signature.

```ts
import { tasks } from "./tasks";

await tasks.sendWelcomeEmail("user-123");
```

## Common Pitfalls

- **Tasks never run and there are no errors.** The enqueuing Lambda was not passed to `grantAccess`, so it lacks the `BEESOLVE_TASKS_MAIN_QUEUE_URL` env var and SendMessage permission.
- **Reusing one definition file.** The same `tasks.ts` is bundled into the handler Lambda and imported by enqueuing Lambdas. Keep it free of handler-only side effects at module load.
- **Low throughput.** The construct defaults to `reservedConcurrentExecutions: 2`. Raise it in `handlerProps` for busy queues.
- **This construct does not use EventBridge.** The `SqsHandler` construct attaches the queue directly as the Lambda event source. You enqueue work with the typed `tasks` client, not through an EventBridge rule.

## See Also

- [Error Handling and DLQ](./error-handling-and-dlq.md)
- [README](../../README.md) - full API reference, FIFO queues, multiple-queue routing, and local development
