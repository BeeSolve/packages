import { describe, expect, it, mock } from "bun:test";

import type { IpInfoCacheItem } from "../ipInfo.ts";
import type { Report } from "../report.ts";
import { runBackfill } from "../src/runBackfill.ts";

function makeReport(props: {
  readonly reportId: string;
  readonly sourceIps: Array<string>;
}): Report {
  return {
    pk: "domain#example.com",
    sk: `report#1#org#${props.reportId}`,
    domain: "example.com",
    orgName: "org",
    reportId: props.reportId,
    email: "reports@org.test",
    dateRangeBegin: 1,
    dateRangeEnd: 2,
    adkim: "r",
    aspf: "r",
    policy: "none",
    pct: 100,
    totalMessages: props.sourceIps.length,
    totalPass: props.sourceIps.length,
    totalFail: 0,
    records: props.sourceIps.map((sourceIp) => ({
      sourceIp,
      count: 1,
      policyEvaluated: {
        disposition: "none",
        dkim: "pass",
        spf: "pass",
        reason: [],
      },
      identifiers: {
        headerFrom: "example.com",
      },
      authResults: {
        dkim: [],
        spf: [],
      },
    })),
    receivedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("runBackfill", () => {
  it("paginates queryByDomain, dedupes source IPs, and completes with correct counts", async () => {
    // Page 1: two reports with overlapping IPs; returns a cursor to force a second page.
    // Page 2: one report with a duplicate and a new IP; no cursor ends the loop.
    const firstPage = {
      reports: [
        makeReport({ reportId: "r1", sourceIps: ["1.1.1.1", "2.2.2.2"] }),
        makeReport({ reportId: "r2", sourceIps: ["2.2.2.2", "3.3.3.3"] }),
      ],
      cursor: "cursor-page-2",
    };
    const secondPage = {
      reports: [makeReport({ reportId: "r3", sourceIps: ["3.3.3.3", "4.4.4.4"] })],
      cursor: undefined,
    };

    const queryByDomain = mock(
      (props: {
        readonly domain: string;
        readonly startTime?: number;
        readonly endTime?: number;
        readonly limit?: number;
        readonly cursor?: string;
      }): Promise<{ reports: Array<Report>; cursor: string | undefined }> =>
        Promise.resolve(props.cursor == null ? firstPage : secondPage),
    );

    const enriched: Record<string, IpInfoCacheItem> = {
      "1.1.1.1": buildCacheItem("1.1.1.1"),
      "2.2.2.2": buildCacheItem("2.2.2.2"),
      "3.3.3.3": buildCacheItem("3.3.3.3"),
      "4.4.4.4": buildCacheItem("4.4.4.4"),
    };
    const enrichMany = mock(
      (_props: { readonly ips: Array<string> }): Promise<Record<string, IpInfoCacheItem>> =>
        Promise.resolve(enriched),
    );
    const completeRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly counts?: { readonly ipsEnriched?: number; readonly reportsScanned?: number };
      }): Promise<void> => Promise.resolve(),
    );
    const failRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly error: string;
      }): Promise<void> => Promise.resolve(),
    );

    await runBackfill({
      reports: { queryByDomain },
      ipInfoCache: { enrichMany },
      backfill: { completeRun, failRun },
      domain: "example.com",
      runId: "run-1",
    });

    expect(queryByDomain).toHaveBeenCalledTimes(2);
    expect(queryByDomain.mock.calls[0]?.[0]).toEqual({ domain: "example.com", cursor: undefined });
    expect(queryByDomain.mock.calls[1]?.[0]).toEqual({
      domain: "example.com",
      cursor: "cursor-page-2",
    });

    expect(enrichMany).toHaveBeenCalledTimes(1);
    const enrichedIps = enrichMany.mock.calls[0]?.[0]?.ips ?? [];
    expect([...enrichedIps].sort((left, right) => left.localeCompare(right))).toEqual([
      "1.1.1.1",
      "2.2.2.2",
      "3.3.3.3",
      "4.4.4.4",
    ]);

    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(completeRun.mock.calls[0]?.[0]).toEqual({
      domain: "example.com",
      runId: "run-1",
      counts: { ipsEnriched: 4, reportsScanned: 3 },
    });
    expect(failRun).not.toHaveBeenCalled();
  });

  it("records a failure and rethrows when the query fails", async () => {
    const queryByDomain = mock(
      (_props: {
        readonly domain: string;
        readonly startTime?: number;
        readonly endTime?: number;
        readonly limit?: number;
        readonly cursor?: string;
      }): Promise<{ reports: Array<Report>; cursor: string | undefined }> =>
        Promise.reject(new Error("query boom")),
    );
    const enrichMany = mock(
      (_props: { readonly ips: Array<string> }): Promise<Record<string, IpInfoCacheItem>> =>
        Promise.resolve({}),
    );
    const completeRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly counts?: { readonly ipsEnriched?: number; readonly reportsScanned?: number };
      }): Promise<void> => Promise.resolve(),
    );
    const failRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly error: string;
      }): Promise<void> => Promise.resolve(),
    );

    let caught: unknown;
    try {
      await runBackfill({
        reports: { queryByDomain },
        ipInfoCache: { enrichMany },
        backfill: { completeRun, failRun },
        domain: "example.com",
        runId: "run-1",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : null).toBe("query boom");

    expect(failRun).toHaveBeenCalledTimes(1);
    expect(failRun.mock.calls[0]?.[0]).toEqual({
      domain: "example.com",
      runId: "run-1",
      error: "query boom",
    });
    expect(completeRun).not.toHaveBeenCalled();
    expect(enrichMany).not.toHaveBeenCalled();
  });
});

function buildCacheItem(ip: string): IpInfoCacheItem {
  return {
    pk: `ipinfo#${ip}`,
    sk: "ipinfo",
    ip,
    fetchedAt: "2024-01-01T00:00:00.000Z",
  };
}
