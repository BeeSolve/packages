import { describe, expect, it } from "bun:test";

import type { TotalsItem } from "@beesolve/analytics-processor";

import {
  clampSize,
  groupMonthlyByYear,
  resolveWindow,
  yearViewMaxMonths,
  zeroFillSeries,
} from "../src/lib/overviewWindow.ts";

function totalsItem({ timeKey, hits }: { timeKey: string; hits: number }): TotalsItem {
  return {
    pk: "totals#month",
    sk: timeKey,
    grain: "month",
    timeKey,
    hits,
    success: hits,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    bytesSent: hits * 10,
    bytesReceived: hits * 2,
    cacheHits: hits,
    cacheMisses: 0,
    cacheErrors: 0,
  };
}

describe("clampSize", () => {
  it("clamps oversize requests to the per-grain maximum", () => {
    expect(clampSize({ grain: "hour", size: 999, years: false })).toBe(24);
    expect(clampSize({ grain: "day", size: 999, years: false })).toBe(30);
    expect(clampSize({ grain: "month", size: 999, years: false })).toBe(12);
  });

  it("clamps year-mode requests to 120 months", () => {
    expect(clampSize({ grain: "month", size: 999, years: true })).toBe(yearViewMaxMonths);
    expect(yearViewMaxMonths).toBe(120);
  });

  it("defaults to the maximum when size is missing", () => {
    expect(clampSize({ grain: "hour", size: undefined, years: false })).toBe(24);
    expect(clampSize({ grain: "day", size: undefined, years: false })).toBe(30);
  });

  it("floors to at least one bucket", () => {
    expect(clampSize({ grain: "day", size: 0, years: false })).toBe(1);
    expect(clampSize({ grain: "day", size: -5, years: false })).toBe(1);
  });
});

describe("resolveWindow", () => {
  it("clamps size and computes window keys for a daily window", () => {
    const anchor = new Date("2026-02-14T09:00:00.000Z");
    const resolved = resolveWindow({ grain: "day", anchor, size: 999 });

    expect(resolved.grain).toBe("day");
    expect(resolved.size).toBe(30);
    expect(resolved.endKey).toBe("2026-02-14");
    expect(resolved.startKey).toBe("2026-01-16");
    expect(resolved.bucketKeys).toHaveLength(30);
    expect(resolved.bucketKeys[0]).toBe("2026-01-16");
    expect(resolved.bucketKeys.at(-1)).toBe("2026-02-14");
  });

  it("computes correct prev/next anchors for a sample daily anchor", () => {
    const anchor = new Date("2026-02-14T09:00:00.000Z");
    const resolved = resolveWindow({ grain: "day", anchor, size: 7 });

    expect(resolved.size).toBe(7);
    expect(resolved.prevAnchor).toBe("2026-02-07T09:00:00.000Z");
    expect(resolved.nextAnchor).toBe("2026-02-21T09:00:00.000Z");
  });

  it("computes correct prev/next anchors for an hourly anchor", () => {
    const anchor = new Date("2026-02-14T09:00:00.000Z");
    const resolved = resolveWindow({ grain: "hour", anchor, size: 24 });

    expect(resolved.endKey).toBe("2026-02-14-09");
    expect(resolved.startKey).toBe("2026-02-13-10");
    expect(resolved.prevAnchor).toBe("2026-02-13T09:00:00.000Z");
    expect(resolved.nextAnchor).toBe("2026-02-15T09:00:00.000Z");
  });

  it("maps year mode onto the monthly grain capped at 120", () => {
    const anchor = new Date("2026-06-15T00:00:00.000Z");
    const resolved = resolveWindow({ grain: "month", anchor, size: 999, years: true });

    expect(resolved.grain).toBe("month");
    expect(resolved.size).toBe(120);
    expect(resolved.endKey).toBe("2026-06");
    expect(resolved.bucketKeys).toHaveLength(120);
  });
});

describe("zeroFillSeries", () => {
  it("fills missing buckets with zeroed totals", () => {
    const anchor = new Date("2026-03-10T00:00:00.000Z");
    const resolved = resolveWindow({ grain: "day", anchor, size: 3 });
    const items = [totalsItem({ timeKey: "2026-03-09", hits: 5 })];

    const series = zeroFillSeries({ bucketKeys: resolved.bucketKeys, grain: "day", items });

    expect(series).toHaveLength(3);
    expect(series.map((bucket) => bucket.timeKey)).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(series[0]?.hits).toBe(0);
    expect(series[1]?.hits).toBe(5);
    expect(series[2]?.hits).toBe(0);
  });
});

describe("groupMonthlyByYear", () => {
  it("groups 24 monthly items into 2 year buckets with summed hits", () => {
    const items: Array<TotalsItem> = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const month = (monthIndex + 1).toString().padStart(2, "0");
      items.push(totalsItem({ timeKey: `2025-${month}`, hits: 10 }));
      items.push(totalsItem({ timeKey: `2026-${month}`, hits: 20 }));
    }

    const years = groupMonthlyByYear(items);

    expect(years).toHaveLength(2);
    expect(years.map((year) => year.year)).toEqual(["2025", "2026"]);
    expect(years[0]?.hits).toBe(120);
    expect(years[1]?.hits).toBe(240);
    expect(years[0]?.bytesSent).toBe(1200);
  });
});
