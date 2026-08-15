import { describe, expect, it } from "bun:test";

import { aggregateReports } from "../src/lib/server/aggregate.ts";

function makeReport(overrides: {
  records: Array<{
    sourceIp: string;
    count: number;
    policyEvaluated: {
      disposition: "none" | "quarantine" | "reject";
      dkim: "pass" | "fail";
      spf: "pass" | "fail";
    };
  }>;
  totalMessages?: number;
  totalPass?: number;
  totalFail?: number;
}) {
  const totalMessages =
    overrides.totalMessages ?? overrides.records.reduce((sum, record) => sum + record.count, 0);
  const totalFail =
    overrides.totalFail ??
    overrides.records
      .filter((record) => record.policyEvaluated.disposition !== "none")
      .reduce((sum, record) => sum + record.count, 0);
  const totalPass = overrides.totalPass ?? totalMessages - totalFail;

  return {
    pk: "domain#example.org",
    sk: "report#1704067200#ExampleCorp#r1",
    domain: "example.org",
    orgName: "Example Corp",
    reportId: "r1",
    email: "postmaster@example.com",
    dateRangeBegin: 1704067200,
    dateRangeEnd: 1704153600,
    adkim: "r" as const,
    aspf: "r" as const,
    policy: "none" as const,
    pct: 100,
    totalMessages,
    totalPass,
    totalFail,
    records: overrides.records.map((record) => ({
      ...record,
      identifiers: { headerFrom: "example.org" },
      authResults: { dkim: [], spf: [] },
    })),
    receivedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("aggregateReports", () => {
  it("computes totals from multiple reports", () => {
    const reports = [
      makeReport({
        records: [
          {
            sourceIp: "1.1.1.1",
            count: 5,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
          },
        ],
        totalMessages: 5,
        totalPass: 5,
        totalFail: 0,
      }),
      makeReport({
        records: [
          {
            sourceIp: "2.2.2.2",
            count: 3,
            policyEvaluated: { disposition: "reject", dkim: "fail", spf: "fail" },
          },
        ],
        totalMessages: 3,
        totalPass: 0,
        totalFail: 3,
      }),
    ];

    const result = aggregateReports(reports);

    expect(result.totalMessages).toBe(8);
    expect(result.totalPass).toBe(5);
    expect(result.totalFail).toBe(3);
    expect(result.uniqueIps).toBe(2);
    expect(result.reportCount).toBe(2);
  });

  it("computes SPF and DKIM pass rates separately", () => {
    const reports = [
      makeReport({
        records: [
          {
            sourceIp: "1.1.1.1",
            count: 7,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
          },
          {
            sourceIp: "2.2.2.2",
            count: 3,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "fail" },
          },
        ],
      }),
    ];

    const result = aggregateReports(reports);

    expect(result.spfPassRate).toBe(70);
    expect(result.dkimPassRate).toBe(100);
  });

  it("aggregates same IP across multiple reports", () => {
    const reports = [
      makeReport({
        records: [
          {
            sourceIp: "1.1.1.1",
            count: 5,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
          },
        ],
      }),
      makeReport({
        records: [
          {
            sourceIp: "1.1.1.1",
            count: 3,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "fail" },
          },
        ],
      }),
    ];

    const result = aggregateReports(reports);

    expect(result.uniqueIps).toBe(1);
    expect(result.sourceIpBreakdown.length).toBe(1);
    expect(result.sourceIpBreakdown[0]?.count).toBe(8);
    expect(result.sourceIpBreakdown[0]?.spfPass).toBe(5);
    expect(result.sourceIpBreakdown[0]?.spfFail).toBe(3);
  });

  it("sorts source IPs by volume descending and limits to 20", () => {
    const records = Array.from({ length: 25 }, (_, index) => ({
      sourceIp: `10.0.0.${String(index + 1)}`,
      count: 25 - index,
      policyEvaluated: {
        disposition: "none" as const,
        dkim: "pass" as const,
        spf: "pass" as const,
      },
    }));

    const reports = [makeReport({ records })];
    const result = aggregateReports(reports);

    expect(result.sourceIpBreakdown.length).toBe(20);
    expect(result.sourceIpBreakdown[0]?.ip).toBe("10.0.0.1");
    expect(result.sourceIpBreakdown[0]?.count).toBe(25);
    expect(result.uniqueIps).toBe(25);
  });

  it("returns zeros for empty reports array", () => {
    const result = aggregateReports([]);

    expect(result.totalMessages).toBe(0);
    expect(result.totalPass).toBe(0);
    expect(result.totalFail).toBe(0);
    expect(result.uniqueIps).toBe(0);
    expect(result.reportCount).toBe(0);
    expect(result.spfPassRate).toBe(0);
    expect(result.dkimPassRate).toBe(0);
    expect(result.sourceIpBreakdown).toEqual([]);
  });

  it("handles reports with empty records array", () => {
    const reports = [makeReport({ records: [], totalMessages: 0, totalPass: 0, totalFail: 0 })];

    const result = aggregateReports(reports);

    expect(result.totalMessages).toBe(0);
    expect(result.uniqueIps).toBe(0);
    expect(result.sourceIpBreakdown).toEqual([]);
  });

  it("collects unique dispositions per IP", () => {
    const reports = [
      makeReport({
        records: [
          {
            sourceIp: "1.1.1.1",
            count: 5,
            policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
          },
          {
            sourceIp: "1.1.1.1",
            count: 2,
            policyEvaluated: { disposition: "quarantine", dkim: "fail", spf: "fail" },
          },
        ],
      }),
    ];

    const result = aggregateReports(reports);

    expect(result.sourceIpBreakdown[0]?.dispositions).toContain("none");
    expect(result.sourceIpBreakdown[0]?.dispositions).toContain("quarantine");
  });
});
