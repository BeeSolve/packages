import { describe, expect, it, mock } from "bun:test";

import type { DmarcReport } from "@beesolve/dmarc-reports";

import { ReportNotFoundError, Reports } from "../report.ts";

function makeDynamo() {
  const send = mock(() => Promise.resolve({}));
  return { send };
}

function makeReport(
  overrides?: Partial<{ domain: string; orgName: string; reportId: string; begin: number }>,
): DmarcReport {
  return {
    reportMetadata: {
      orgName: overrides?.orgName ?? "Google Inc.",
      email: "noreply-dmarc-support@google.com",
      reportId: overrides?.reportId ?? "report-001",
      dateRange: {
        begin: overrides?.begin ?? 1704067200,
        end: 1704153600,
      },
    },
    policyPublished: {
      domain: overrides?.domain ?? "example.org",
      adkim: "r",
      aspf: "r",
      p: "none",
      pct: 100,
    },
    records: [
      {
        sourceIp: "192.0.2.1",
        count: 10,
        policyEvaluated: {
          disposition: "none",
          dkim: "pass",
          spf: "pass",
        },
        identifiers: {
          headerFrom: "example.org",
        },
        authResults: {
          dkim: [{ domain: "example.org", result: "pass" }],
          spf: [{ domain: "example.org", result: "pass" }],
        },
      },
      {
        sourceIp: "198.51.100.5",
        count: 3,
        policyEvaluated: {
          disposition: "quarantine",
          dkim: "fail",
          spf: "fail",
        },
        identifiers: {
          headerFrom: "example.org",
        },
        authResults: {
          dkim: [{ domain: "example.org", result: "fail" }],
          spf: [{ domain: "example.org", result: "fail" }],
        },
      },
    ],
  };
}

interface BatchWriteInput {
  RequestItems?: Record<string, Array<{ PutRequest?: { Item?: Record<string, unknown> } }>>;
}

interface QueryInput {
  KeyConditionExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
}

interface GetInput {
  TableName?: string;
  Key?: Record<string, unknown>;
}

function getBatchWriteInput(send: ReturnType<typeof mock>, index = 0): BatchWriteInput {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
  return command.input as BatchWriteInput;
}

function getQueryInput(send: ReturnType<typeof mock>, index = 0): QueryInput {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
  return command.input as QueryInput;
}

function getGetInput(send: ReturnType<typeof mock>, index = 0): GetInput {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
  return command.input as GetInput;
}

describe("Reports", () => {
  describe("persist", () => {
    it("writes reports as DynamoDB items with correct keys", async () => {
      const dynamo = makeDynamo();
      const reports = new Reports({ dynamo, tableName: "test-table" });

      const report = makeReport({
        domain: "example.org",
        orgName: "Google Inc.",
        reportId: "rpt-123",
        begin: 1704067200,
      });

      await reports.persist({ reports: [report] });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getBatchWriteInput(dynamo.send);
      const items = input.RequestItems?.["test-table"];
      expect(items).toBeDefined();
      if (items == null) return;

      expect(items.length).toBe(1);
      const item = items[0]?.PutRequest?.Item;
      expect(item).toBeDefined();
      if (item == null) return;

      expect(item.pk).toBe("domain#example.org");
      expect(item.sk).toBe("report#1704067200#Google Inc.#rpt-123");
      expect(item.domain).toBe("example.org");
      expect(item.orgName).toBe("Google Inc.");
      expect(item.reportId).toBe("rpt-123");
      expect(item.totalMessages).toBe(13);
      expect(item.totalPass).toBe(10);
      expect(item.totalFail).toBe(3);
    });

    it("batches more than 25 reports into multiple writes", async () => {
      const dynamo = makeDynamo();
      const reports = new Reports({ dynamo, tableName: "test-table" });

      const dmarcReports = Array.from({ length: 30 }, (_, i) =>
        makeReport({ reportId: `rpt-${String(i).padStart(3, "0")}`, begin: 1704067200 + i }),
      );

      await reports.persist({ reports: dmarcReports });

      expect(dynamo.send).toHaveBeenCalledTimes(2);
    });
  });

  describe("queryByDomain", () => {
    it("queries with correct key condition and returns parsed results", async () => {
      const storedItem = {
        pk: "domain#example.org",
        sk: "report#1704067200#Google Inc.#rpt-001",
        domain: "example.org",
        orgName: "Google Inc.",
        reportId: "rpt-001",
        email: "noreply@google.com",
        dateRangeBegin: 1704067200,
        dateRangeEnd: 1704153600,
        adkim: "r",
        aspf: "r",
        policy: "none",
        pct: 100,
        totalMessages: 10,
        totalPass: 10,
        totalFail: 0,
        records: [],
        receivedAt: "2024-01-01T12:00:00.000Z",
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [storedItem], LastEvaluatedKey: undefined });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      const result = await reports.queryByDomain({ domain: "example.org" });

      expect(result.reports.length).toBe(1);
      expect(result.reports[0]?.domain).toBe("example.org");
      expect(result.cursor).toBeUndefined();

      const input = getQueryInput(dynamo.send);
      expect(input.KeyConditionExpression).toBe("#pk = :pk AND begins_with(#sk, :skPrefix)");
      expect(input.ExpressionAttributeValues?.[":pk"]).toBe("domain#example.org");
      expect(input.ExpressionAttributeValues?.[":skPrefix"]).toBe("report#");
    });

    it("applies time range filter when startTime and endTime are provided", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      await reports.queryByDomain({
        domain: "example.org",
        startTime: 1704067200,
        endTime: 1704153600,
      });

      const input = getQueryInput(dynamo.send);
      expect(input.KeyConditionExpression).toBe("#pk = :pk AND #sk BETWEEN :start AND :end");
    });

    it("returns a cursor when LastEvaluatedKey is present", async () => {
      const lastKey = { pk: "domain#example.org", sk: "1704067200#Google#rpt-001" };
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lastKey });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      const result = await reports.queryByDomain({ domain: "example.org" });

      expect(result.cursor).toBeDefined();
      if (result.cursor == null) return;

      const decoded = JSON.parse(Buffer.from(result.cursor, "base64url").toString());
      expect(decoded).toEqual(lastKey);
    });
  });

  describe("getReport", () => {
    it("sends GetCommand with correct composite key", async () => {
      const storedItem = {
        pk: "domain#example.org",
        sk: "report#1704067200#Google Inc.#rpt-001",
        domain: "example.org",
        orgName: "Google Inc.",
        reportId: "rpt-001",
        email: "noreply@google.com",
        dateRangeBegin: 1704067200,
        dateRangeEnd: 1704153600,
        adkim: "r",
        aspf: "r",
        policy: "none",
        pct: 100,
        totalMessages: 10,
        totalPass: 10,
        totalFail: 0,
        records: [],
        receivedAt: "2024-01-01T12:00:00.000Z",
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: storedItem });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      const result = await reports.getReport({
        domain: "example.org",
        timestamp: 1704067200,
        orgName: "Google Inc.",
        reportId: "rpt-001",
      });

      expect(result).toBeDefined();
      expect(result.reportId).toBe("rpt-001");
      expect(result.domain).toBe("example.org");

      const input = getGetInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({
        pk: "domain#example.org",
        sk: "report#1704067200#Google Inc.#rpt-001",
      });
    });

    it("throws ReportNotFoundError when item does not exist", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: undefined });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      expect(
        reports.getReport({
          domain: "example.org",
          timestamp: 1704067200,
          orgName: "Google Inc.",
          reportId: "nonexistent",
        }),
      ).rejects.toThrow(ReportNotFoundError);
    });
  });

  describe("getDailyAggregate", () => {
    it("queries reports for the given day and computes aggregate", async () => {
      const storedItem = {
        pk: "domain#example.org",
        sk: "report#1704067200#Google Inc.#rpt-001",
        domain: "example.org",
        orgName: "Google Inc.",
        reportId: "rpt-001",
        email: "noreply@google.com",
        dateRangeBegin: 1704067200,
        dateRangeEnd: 1704153600,
        adkim: "r",
        aspf: "r",
        policy: "none",
        pct: 100,
        totalMessages: 13,
        totalPass: 10,
        totalFail: 3,
        records: [
          {
            sourceIp: "192.0.2.1",
            count: 10,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
            identifiers: { headerFrom: "example.org" },
            authResults: { dkim: [], spf: [] },
          },
          {
            sourceIp: "198.51.100.5",
            count: 3,
            policyEvaluated: { disposition: "quarantine", dkim: "fail", spf: "fail" },
            identifiers: { headerFrom: "example.org" },
            authResults: { dkim: [], spf: [] },
          },
        ],
        receivedAt: "2024-01-01T12:00:00.000Z",
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [storedItem], LastEvaluatedKey: undefined });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      const result = await reports.getDailyAggregate({ domain: "example.org", date: "2024-01-01" });

      expect(result.domain).toBe("example.org");
      expect(result.date).toBe("2024-01-01");
      expect(result.totalMessages).toBe(13);
      expect(result.totalPass).toBe(10);
      expect(result.totalFail).toBe(3);
      expect(result.reportCount).toBe(1);
      expect(result.topFailingIps.length).toBe(1);
      expect(result.topFailingIps[0]?.ip).toBe("198.51.100.5");
      expect(result.topFailingIps[0]?.count).toBe(3);
    });

    it("returns zero totals when no reports for the day", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      const result = await reports.getDailyAggregate({ domain: "example.org", date: "2024-01-01" });

      expect(result.totalMessages).toBe(0);
      expect(result.totalPass).toBe(0);
      expect(result.totalFail).toBe(0);
      expect(result.reportCount).toBe(0);
      expect(result.topFailingIps).toEqual([]);
    });
  });

  describe("getDailyAggregateAllDomains", () => {
    it("returns aggregates for domains with activity and filters out zero-activity domains", async () => {
      const storedItem = {
        pk: "domain#example.org",
        sk: "report#1704067200#Google Inc.#rpt-001",
        domain: "example.org",
        orgName: "Google Inc.",
        reportId: "rpt-001",
        email: "noreply@google.com",
        dateRangeBegin: 1704067200,
        dateRangeEnd: 1704153600,
        adkim: "r",
        aspf: "r",
        policy: "none",
        pct: 100,
        totalMessages: 5,
        totalPass: 5,
        totalFail: 0,
        records: [
          {
            sourceIp: "1.1.1.1",
            count: 5,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
            identifiers: { headerFrom: "example.org" },
            authResults: { dkim: [], spf: [] },
          },
        ],
        receivedAt: "2024-01-01T12:00:00.000Z",
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [storedItem], LastEvaluatedKey: undefined });
      dynamo.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const reports = new Reports({ dynamo, tableName: "test-table" });

      const result = await reports.getDailyAggregateAllDomains({
        domains: ["example.org", "inactive.org"],
        date: "2024-01-01",
      });

      expect(result.length).toBe(1);
      expect(result[0]?.domain).toBe("example.org");
      expect(result[0]?.totalMessages).toBe(5);
    });
  });
});
