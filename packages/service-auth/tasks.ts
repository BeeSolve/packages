import { SQSClient } from "@aws-sdk/client-sqs";
import { createSqsHandlers } from "@beesolve/sqs-handler";
import { toDynamoClient } from "./src/dynamo.ts";
import { Sessions } from "./src/session.ts";

const sessions = new Sessions({
  dynamo: toDynamoClient(),
  tableName: process.env.SESSIONS_TABLE_NAME!,
  userIdIndexName: process.env.SESSIONS_USER_ID_INDEX_NAME!,
});

export const [handler, tasks] = createSqsHandlers({
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: { main: process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL! },
  functions: {
    deleteSession: async (sid: string) => {
      await sessions.delete(sid);
    },
  },
});
