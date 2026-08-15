import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchWriteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import type { DmarcReport } from "@beesolve/dmarc-reports";
import { splitArrayToChunks } from "@beesolve/helpers";
import * as v from "valibot";

export const schema = v.object({
  pk: v.string(),
  sk: v.string(),
  domain: v.string(),
  orgName: v.string(),
  reportId: v.string(),
  email: v.string(),
  dateRangeBegin: v.number(),
  dateRangeEnd: v.number(),
  adkim: v.picklist(["r", "s"]),
  aspf: v.picklist(["r", "s"]),
  policy: v.picklist(["none", "quarantine", "reject"]),
  pct: v.number(),
  totalMessages: v.number(),
  totalPass: v.number(),
  totalFail: v.number(),
  records: v.array(v.unknown()),
  receivedAt: v.string(),
});

export type Report = v.InferOutput<typeof schema>;

export interface DailyAggregate {
  domain: string;
  date: string;
  totalMessages: number;
  totalPass: number;
  totalFail: number;
  reportCount: number;
  topFailingIps: Array<{ ip: string; count: number; spfResult: string; dkimResult: string }>;
}

const cursorSchema = v.object({
  pk: v.string(),
  sk: v.string(),
});

export class Reports {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
    },
  ) {}

  readonly persist = async (props: { readonly reports: Array<DmarcReport> }): Promise<void> => {
    for (const batch of splitArrayToChunks(props.reports, 25)) {
      await this.props.dynamo.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.props.tableName]: batch.map((report) => ({
              PutRequest: { Item: this.toItem(report) },
            })),
          },
        }),
      );
    }
  };

  readonly queryByDomain = async (props: {
    readonly domain: string;
    readonly startTime?: number;
    readonly endTime?: number;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<{ reports: Array<Report>; cursor: string | undefined }> => {
    const { keyCondition, expressionNames, expressionValues } = buildKeyCondition({
      domain: props.domain,
      startTime: props.startTime,
      endTime: props.endTime,
    });

    const exclusiveStartKey =
      props.cursor != null
        ? v.parse(cursorSchema, JSON.parse(Buffer.from(props.cursor, "base64url").toString()))
        : undefined;

    const { Items: items = [], LastEvaluatedKey: lastKey } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        Limit: props.limit ?? 50,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const reports = items.map((item) => this.parseOne(item));
    const cursor =
      lastKey != null ? Buffer.from(JSON.stringify(lastKey)).toString("base64url") : undefined;

    return { reports, cursor };
  };

  readonly getReport = async (props: {
    readonly domain: string;
    readonly timestamp: number;
    readonly orgName: string;
    readonly reportId: string;
  }): Promise<Report> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: {
          pk: `domain#${props.domain}`,
          sk: `report#${String(props.timestamp)}#${props.orgName}#${props.reportId}`,
        },
      }),
    );

    if (item == null) {
      throw new ReportNotFoundError(props.domain, props.orgName, props.reportId);
    }
    return this.parseOne(item);
  };

  readonly getDailyAggregate = async (props: {
    readonly domain: string;
    readonly date: string;
  }): Promise<DailyAggregate> => {
    const dayStart = Date.parse(`${props.date}T00:00:00Z`) / 1000;
    const dayEnd = dayStart + 86399;

    const { reports } = await this.queryByDomain({
      domain: props.domain,
      startTime: dayStart,
      endTime: dayEnd,
      limit: 1000,
    });

    let totalMessages = 0;
    let totalPass = 0;
    let totalFail = 0;

    const ipMap = new Map<string, { count: number; spfResult: string; dkimResult: string }>();

    for (const report of reports) {
      totalMessages += report.totalMessages;
      totalPass += report.totalPass;
      totalFail += report.totalFail;

      for (const rawRecord of report.records) {
        const record = v.parse(dmarcRecordSchema, rawRecord);
        if (record.policyEvaluated.disposition === "none") continue;

        const existing = ipMap.get(record.sourceIp);
        if (existing != null) {
          existing.count += record.count;
        } else {
          ipMap.set(record.sourceIp, {
            count: record.count,
            spfResult: record.policyEvaluated.spf,
            dkimResult: record.policyEvaluated.dkim,
          });
        }
      }
    }

    const topFailingIps = Array.from(ipMap.entries())
      .map(([ip, data]) => ({
        ip,
        count: data.count,
        spfResult: data.spfResult,
        dkimResult: data.dkimResult,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      domain: props.domain,
      date: props.date,
      totalMessages,
      totalPass,
      totalFail,
      reportCount: reports.length,
      topFailingIps,
    };
  };

  // Fetches all domains in parallel — may need batching/chunking for large numbers of domains
  readonly getDailyAggregateAllDomains = async (props: {
    readonly domains: Array<string>;
    readonly date: string;
  }): Promise<Array<DailyAggregate>> => {
    const results = await Promise.all(
      props.domains.map((domain) => this.getDailyAggregate({ domain, date: props.date })),
    );

    return results.filter((aggregate) => aggregate.totalMessages > 0);
  };

  private readonly toItem = (report: DmarcReport): Report => {
    const domain = report.policyPublished.domain;
    const timestamp = report.reportMetadata.dateRange.begin;
    const orgName = report.reportMetadata.orgName;
    const reportId = report.reportMetadata.reportId;

    const totalMessages = report.records.reduce((sum, r) => sum + r.count, 0);
    const totalFail = report.records
      .filter((r) => r.policyEvaluated.disposition !== "none")
      .reduce((sum, r) => sum + r.count, 0);

    return {
      pk: `domain#${domain}`,
      sk: `report#${String(timestamp)}#${orgName}#${reportId}`,
      domain,
      orgName,
      reportId,
      email: report.reportMetadata.email,
      dateRangeBegin: report.reportMetadata.dateRange.begin,
      dateRangeEnd: report.reportMetadata.dateRange.end,
      adkim: report.policyPublished.adkim,
      aspf: report.policyPublished.aspf,
      policy: report.policyPublished.p,
      pct: report.policyPublished.pct,
      totalMessages,
      totalPass: totalMessages - totalFail,
      totalFail,
      records: report.records,
      receivedAt: new Date().toISOString(),
    };
  };

  private readonly parseOne = (item: unknown): Report => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored DMARC report");
    }
    return result.output;
  };
}

export class ReportNotFoundError extends Error {
  constructor(domain: string, orgName: string, reportId: string) {
    super(`Report not found: ${domain}/${orgName}/${reportId}`);
    this.name = "ReportNotFoundError";
  }
}

function buildKeyCondition(props: {
  readonly domain: string;
  readonly startTime?: number;
  readonly endTime?: number;
}): {
  readonly keyCondition: string;
  readonly expressionNames: Record<string, string>;
  readonly expressionValues: Record<string, unknown>;
} {
  const baseNames: Record<string, string> = { "#pk": "pk", "#sk": "sk" };
  const baseValues: Record<string, unknown> = { ":pk": `domain#${props.domain}` };

  if (props.startTime != null && props.endTime != null) {
    return {
      keyCondition: "#pk = :pk AND #sk BETWEEN :start AND :end",
      expressionNames: baseNames,
      expressionValues: {
        ...baseValues,
        ":start": `report#${String(props.startTime)}`,
        ":end": `report#${String(props.endTime)}~`,
      },
    };
  }

  if (props.startTime != null) {
    return {
      keyCondition: "#pk = :pk AND #sk >= :start",
      expressionNames: baseNames,
      expressionValues: { ...baseValues, ":start": `report#${String(props.startTime)}` },
    };
  }

  if (props.endTime != null) {
    return {
      keyCondition: "#pk = :pk AND #sk <= :end",
      expressionNames: baseNames,
      expressionValues: { ...baseValues, ":end": `report#${String(props.endTime)}~` },
    };
  }

  return {
    keyCondition: "#pk = :pk AND begins_with(#sk, :skPrefix)",
    expressionNames: baseNames,
    expressionValues: { ...baseValues, ":skPrefix": "report#" },
  };
}
