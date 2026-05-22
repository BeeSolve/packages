import { SQSClient } from "@aws-sdk/client-sqs";
import { createSqsHandlers } from "@beesolve/sqs-handler";
import type { SQSEvent } from "aws-lambda";
import * as v from "valibot";
import { toDynamoClient } from "./src/dynamo.ts";
import { Sessions } from "./src/session.ts";

const env = v.parse(
  v.object({
    SESSIONS_TABLE_NAME: v.string(),
    SESSIONS_USER_ID_INDEX_NAME: v.string(),
    BEESOLVE_TASKS_MAIN_QUEUE_URL: v.string(),
  }),
  process.env,
);

const sessions = new Sessions({
  dynamo: toDynamoClient(),
  tableName: env.SESSIONS_TABLE_NAME,
  userIdIndexName: env.SESSIONS_USER_ID_INDEX_NAME,
});

const result = createSqsHandlers({
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: { main: env.BEESOLVE_TASKS_MAIN_QUEUE_URL },
  functions: {
    deleteSession: async (sid: string) => {
      await sessions.delete(sid);
    },
  },
});

export const handler: (event: SQSEvent) => Promise<{ batchItemFailures: { itemIdentifier: string }[] }> = result[0];
export const tasks = result[1];
