import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
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
import { toDynamoClient } from "./dynamo.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
  IPINFO_API_KEY: v.optional(v.string()),
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
    try {
      await reports.persist({ reports: parsedReports });
    } catch (error) {
      console.error("Failed to persist reports to DynamoDB:", error);
      for (const record of event.Records) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
      return { batchItemFailures };
    }

    await upsertDomainAggregates(parsedReports);
    await enrichSourceIps(parsedReports);
  }

  for (const id of failedIds) {
    batchItemFailures.push({ itemIdentifier: id });
  }

  return { batchItemFailures };
}

async function upsertDomainAggregates(reports: Array<DmarcReport>): Promise<void> {
  const aggregates = new Map<
    string,
    { totalMessages: number; totalPass: number; totalFail: number }
  >();

  for (const report of reports) {
    const domain = report.policyPublished.domain;
    const totalMessages = report.records.reduce((sum, record) => sum + record.count, 0);
    const totalFail = report.records
      .filter((record) => record.policyEvaluated.disposition !== "none")
      .reduce((sum, record) => sum + record.count, 0);
    const totalPass = totalMessages - totalFail;

    const existing = aggregates.get(domain);
    if (existing != null) {
      existing.totalMessages += totalMessages;
      existing.totalPass += totalPass;
      existing.totalFail += totalFail;
    } else {
      aggregates.set(domain, { totalMessages, totalPass, totalFail });
    }
  }

  for (const [domain, totals] of aggregates) {
    try {
      await domains.upsert({ domain, ...totals });
    } catch (error) {
      console.error(`Failed to upsert domain aggregate for ${domain}:`, error);
    }
  }
}

// Populates the per-IP ipinfo cache for every unique source IP seen in the
// batch. No-op when IPINFO_API_KEY is not configured. Enrichment failures are
// logged and swallowed so they never fail report persistence.
async function enrichSourceIps(reports: Array<DmarcReport>): Promise<void> {
  const ips = new Set<string>();
  for (const report of reports) {
    for (const rawRecord of report.records) {
      const parsed = v.safeParse(dmarcRecordSchema, rawRecord);
      if (parsed.success) {
        ips.add(parsed.output.sourceIp);
      }
    }
  }

  if (ips.size === 0) return;

  try {
    await ipInfoCache.enrichMany({ ips: Array.from(ips) });
  } catch (error) {
    console.error("Failed to enrich source IPs:", error);
  }
}
