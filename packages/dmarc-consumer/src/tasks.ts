import { SQSClient } from "@aws-sdk/client-sqs";
import { createSqsHandlers } from "@beesolve/sqs-handler";
import * as v from "valibot";

import { IpInfoCache } from "../ipInfo.ts";
import { JobRuns } from "../jobRuns.ts";
import { Reports } from "../report.ts";
import { toDynamoClient } from "./dynamo.ts";
import { runBackfill } from "./runBackfill.ts";

const env = v.parse(
  v.object({
    TABLE_NAME: v.string(),
    IPINFO_API_KEY: v.optional(v.string()),
    BEESOLVE_TASKS_MAIN_QUEUE_URL: v.string(),
  }),
  process.env,
);

const dynamo = toDynamoClient();

const reports = new Reports({ dynamo, tableName: env.TABLE_NAME });
const ipInfoCache = new IpInfoCache({
  dynamo,
  tableName: env.TABLE_NAME,
  apiKey: env.IPINFO_API_KEY,
});
const backfill = new JobRuns({ dynamo, tableName: env.TABLE_NAME, kind: "ipBackfill" });

export const [handler, tasks] = createSqsHandlers({
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: { main: env.BEESOLVE_TASKS_MAIN_QUEUE_URL },
  functions: {
    backfillDomain: async ({ domain, runId }: { domain: string; runId: string }) => {
      await runBackfill({ reports, ipInfoCache, backfill, domain, runId });
    },
  },
});
