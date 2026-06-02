# SQS handler

## Installation

Install the latest version of package:

```bash
npm i @beesolve/sqs-handler
```

## Usage

Create `tasks.ts` file in your server application, which defines your handlers.

```ts
import { createSqsHandlers } from "@beesolve/sqs-handler";
import { SQSClient } from "@aws-sdk/client-sqs";

export const [handler, tasks] = createSqsHandlers({
  fifo: false, // you can create either fifo or standard queues
  sqsClient: new SQSClient(), // provide SQS client
  queueUrls: { main: process.env.BEESOLVE_TASKS_QUEUE_URL! }, // BEESOLVE_TASKS_QUEUE_URL env variable will be automatically injected to your Lambda function
  functions: {
    // here goes your functions
    test: async (payload: any) => {
      console.log({ payload });
    },
  },
});
```

Create `SqsHandler` instance with CDK.

```ts
import { SqsHandler } from "@beesolve/sqs-handler/cdk";

const sqsHandler = new SqsHandler(stack, "SqsHandler", {
  entry: resolve(`src/lib/server/tasks.ts`), // path to your `tasks.ts` file
  handlerProps: {
    memorySize: 1024,
    timeout: Duration.seconds(5),
  },
  alarms,
  // Optional: customer-managed KMS encryption for the SQS queues
  encryptionKey: myKmsKey,
});

sqsHandler.grantAccess(handler);
```




https://logtape.org/manual/install
