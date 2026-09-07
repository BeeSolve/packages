import type { DmarcReport } from "@beesolve/dmarc-reports";
import {
  dmarcProcessingStatsEventSchema,
  dmarcReportParsedEventSchema,
} from "@beesolve/dmarc-reports";
import type { SQSBatchItemFailure, SQSEvent } from "aws-lambda";
import * as v from "valibot";

import { Domains } from "../domain.ts";
import { IpInfoCache } from "../ipInfo.ts";
import { ProcessingStats } from "../processingStats.ts";
import { Reports } from "../report.ts";
import { AdminSdk } from "../sdk.ts";
import { toDynamoClient } from "./dynamo.ts";
import { processReportBatch } from "./reportBatch.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
  IPINFO_API_KEY: v.optional(v.string()),
  BEESOLVE_TASKS_MAIN_QUEUE_URL: v.string(),
});
const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const reports = new Reports({ dynamo, tableName: env.TABLE_NAME });
const domains = new Domains({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const stats = new ProcessingStats({ dynamo, tableName: env.TABLE_NAME });
const ipInfoCache = new IpInfoCache({
  dynamo,
  tableName: env.TABLE_NAME,
  apiKey: env.IPINFO_API_KEY,
});
const adminSdk = new AdminSdk();

export async function handler(
  event: SQSEvent,
): Promise<{ batchItemFailures: Array<SQSBatchItemFailure> }> {
  const batchItemFailures: Array<SQSBatchItemFailure> = [];

  const parsedReports: Array<DmarcReport> = [];
  const failedIds: Array<string> = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body) as unknown;

      const statsResult = v.safeParse(dmarcProcessingStatsEventSchema, body);
      if (statsResult.success) {
        await stats.increment({
          counter: statsResult.output.detail.counter,
          value: statsResult.output.detail.value,
        });
        continue;
      }

      const parsed = v.parse(dmarcReportParsedEventSchema, body);
      parsedReports.push(parsed.detail);
    } catch (error) {
      console.error(`Failed to parse record ${record.messageId}:`, error);
      failedIds.push(record.messageId);
    }
  }

  if (parsedReports.length > 0) {
    const { persistFailed } = await processReportBatch({
      reports,
      domains,
      ipInfoCache,
      adminSdk,
      parsedReports,
    });

    if (persistFailed) {
      for (const record of event.Records) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
      return { batchItemFailures };
    }
  }

  for (const id of failedIds) {
    batchItemFailures.push({ itemIdentifier: id });
  }

  return { batchItemFailures };
}
