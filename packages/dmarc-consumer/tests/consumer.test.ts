import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { DmarcReport } from "@beesolve/dmarc-reports";

import type { IpInfoCacheItem } from "../ipInfo.ts";
import { processReportBatch } from "../src/reportBatch.ts";

const persist = mock((_props: { readonly reports: Array<DmarcReport> }): Promise<void> =>
  Promise.resolve(),
);

const upsert = mock(
  (_props: {
    readonly domain: string;
    readonly totalMessages: number;
    readonly totalPass: number;
    readonly totalFail: number;
  }): Promise<{ readonly created: boolean }> => Promise.resolve({ created: true }),
);

const addSelectors = mock(
  (_props: { readonly domain: string; readonly selectors: Array<string> }): Promise<void> =>
    Promise.resolve(),
);

const enrichMany = mock(
  (_props: { readonly ips: Array<string> }): Promise<Record<string, IpInfoCacheItem>> =>
    Promise.resolve({}),
);

const startDnsRefresh = mock(
  (_props: {
    readonly domain: string;
  }): Promise<{ readonly enqueued: true; readonly runId: string }> =>
    Promise.resolve({ enqueued: true, runId: "run-1" }),
);

function deps() {
  return {
    reports: { persist },
    domains: { upsert, addSelectors },
    ipInfoCache: { enrichMany },
    adminSdk: { startDnsRefresh },
  };
}

function makeReport(props: {
  readonly domain?: string;
  readonly selectors?: Array<string>;
  readonly count?: number;
  readonly disposition?: "none" | "quarantine" | "reject";
}): DmarcReport {
  const domain = props.domain ?? "example.org";
  const selectors = props.selectors ?? [];
  const count = props.count ?? 5;
  const disposition = props.disposition ?? "none";

  return {
    reportMetadata: {
      orgName: "Google Inc.",
      email: "noreply@google.com",
      reportId: "rpt-001",
      dateRange: { begin: 1704067200, end: 1704153600 },
    },
    policyPublished: {
      domain,
      adkim: "r",
      aspf: "r",
      p: "none",
      pct: 100,
    },
    records: [
      {
        sourceIp: "192.0.2.1",
        count,
        policyEvaluated: { disposition, dkim: "pass", spf: "pass" },
        identifiers: { headerFrom: domain },
        authResults: {
          dkim:
            selectors.length > 0
              ? selectors.map((selector) => ({ domain, result: "pass", selector }))
              : [{ domain, result: "pass" }],
          spf: [{ domain, result: "pass" }],
        },
      },
    ],
  };
}

describe("processReportBatch", () => {
  beforeEach(() => {
    persist.mockReset();
    persist.mockImplementation(() => Promise.resolve());
    upsert.mockReset();
    upsert.mockImplementation(() => Promise.resolve({ created: true }));
    addSelectors.mockReset();
    addSelectors.mockImplementation(() => Promise.resolve());
    enrichMany.mockReset();
    enrichMany.mockImplementation(() => Promise.resolve({}));
    startDnsRefresh.mockReset();
    startDnsRefresh.mockImplementation(() => Promise.resolve({ enqueued: true, runId: "run-1" }));
  });

  it("persists successfully and signals no failure", async () => {
    const result = await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({})],
    });

    expect(result.persistFailed).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]?.[0]?.reports.length).toBe(1);
  });

  it("signals total failure when persist throws", async () => {
    persist.mockRejectedValueOnce(new Error("DynamoDB error"));

    const result = await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({}), makeReport({})],
    });

    expect(result.persistFailed).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
    expect(addSelectors).not.toHaveBeenCalled();
    expect(startDnsRefresh).not.toHaveBeenCalled();
  });

  it("upserts domain aggregates with the totals for a single report", async () => {
    await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org", count: 5 })],
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toEqual({
      domain: "example.org",
      totalMessages: 5,
      totalPass: 5,
      totalFail: 0,
    });
  });

  it("aggregates multiple reports for the same domain into one upsert", async () => {
    await processReportBatch({
      ...deps(),
      parsedReports: [
        makeReport({ domain: "example.org", count: 5 }),
        makeReport({ domain: "example.org", count: 5 }),
      ],
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toEqual({
      domain: "example.org",
      totalMessages: 10,
      totalPass: 10,
      totalFail: 0,
    });
  });

  it("splits failing message counts into totalFail", async () => {
    await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org", count: 5, disposition: "reject" })],
    });

    expect(upsert.mock.calls[0]?.[0]).toEqual({
      domain: "example.org",
      totalMessages: 5,
      totalPass: 0,
      totalFail: 5,
    });
  });

  it("swallows a per-domain upsert rejection without throwing", async () => {
    upsert.mockRejectedValueOnce(new Error("UpdateCommand failed"));

    const result = await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org" })],
    });

    expect(result.persistFailed).toBe(false);
  });

  it("persists observed DKIM selectors as the seen set", async () => {
    await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org", selectors: ["sel1", "sel2"] })],
    });

    expect(addSelectors).toHaveBeenCalledTimes(1);
    expect(addSelectors.mock.calls[0]?.[0]?.domain).toBe("example.org");
    expect(new Set(addSelectors.mock.calls[0]?.[0]?.selectors)).toEqual(new Set(["sel1", "sel2"]));
  });

  it("does not call addSelectors when no selectors are observed", async () => {
    await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org", selectors: [] })],
    });

    expect(addSelectors).not.toHaveBeenCalled();
  });

  it("bootstraps exactly one DNS refresh for a brand-new domain", async () => {
    upsert.mockImplementation(() => Promise.resolve({ created: true }));

    await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org" })],
    });

    expect(startDnsRefresh).toHaveBeenCalledTimes(1);
    expect(startDnsRefresh.mock.calls[0]?.[0]).toEqual({ domain: "example.org" });
  });

  it("does not bootstrap DNS refresh for an already-existing domain", async () => {
    upsert.mockImplementation(() => Promise.resolve({ created: false }));

    await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org" })],
    });

    expect(startDnsRefresh).not.toHaveBeenCalled();
  });

  it("does not throw when the DNS bootstrap enqueue rejects", async () => {
    startDnsRefresh.mockRejectedValueOnce(new Error("enqueue failed"));

    const result = await processReportBatch({
      ...deps(),
      parsedReports: [makeReport({ domain: "example.org" })],
    });

    expect(result.persistFailed).toBe(false);
  });
});
