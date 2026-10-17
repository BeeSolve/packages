import { describe, expect, it } from "bun:test";

import type { BreakdownItem } from "../src/breakdowns.ts";
import type { ResolveModels } from "../src/resolveLive.ts";
import {
  classifyBucketState,
  resolveBreakdownLive,
  resolveTotalsLive,
} from "../src/resolveLive.ts";
import type { TotalsItem } from "../src/totals.ts";

function totalsItem(timeKey: string, grain: "hour" | "day" | "month", hits: number): TotalsItem {
  return {
    pk: `totals#${grain}`,
    sk: timeKey,
    grain,
    timeKey,
    hits,
    success: hits,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    bytesSent: hits * 10,
    bytesReceived: hits * 5,
    cacheHits: hits,
    cacheMisses: 0,
    cacheErrors: 0,
  };
}

function breakdownItem(value: string, hits: number): BreakdownItem {
  return {
    pk: "breakdown#country#hour#x",
    sk: value,
    dimension: "country",
    grain: "hour",
    periodKey: "x",
    value,
    hits,
    bytes: hits * 2,
  };
}

interface Store {
  readonly totalsByGrain: Record<string, Record<string, TotalsItem>>;
  readonly markers: Set<string>;
  readonly breakdownsByKey: Record<string, Array<BreakdownItem>>;
}

interface Spy {
  readonly hourQueries: Array<string>;
  readonly dayQueries: Array<string>;
}

function makeModels(store: Store, spy?: Spy): ResolveModels {
  return {
    totals: {
      queryWindow: async ({ grain, startKey, endKey }) => {
        if (spy != null && grain === "hour") spy.hourQueries.push(`${startKey}..${endKey}`);
        if (spy != null && grain === "day") spy.dayQueries.push(`${startKey}..${endKey}`);
        const byKey = store.totalsByGrain[grain] ?? {};
        return Object.values(byKey).filter(
          (item) => item.timeKey >= startKey && item.timeKey <= endKey,
        );
      },
      getOne: async ({ grain, timeKey }) => (store.totalsByGrain[grain] ?? {})[timeKey],
    },
    breakdowns: {
      getForPeriod: async ({ dimension, grain, periodKey }) =>
        store.breakdownsByKey[`${dimension}#${grain}#${periodKey}`] ?? [],
    },
    markers: {
      isApplied: async ({ grain, periodKey }) => store.markers.has(`${grain}#${periodKey}`),
    },
  };
}

describe("resolveTotalsLive", () => {
  it("sums the hours ingested so far for the current, not-yet-rolled-up day", async () => {
    const now = new Date("2026-10-13T11:30:00Z");
    const hours: Record<string, TotalsItem> = {};
    for (let hour = 0; hour <= 10; hour += 1) {
      const key = `2026-10-13-${hour.toString().padStart(2, "0")}`;
      hours[key] = totalsItem(key, "hour", 2);
    }
    const models = makeModels({
      totalsByGrain: { hour: hours },
      markers: new Set(),
      breakdownsByKey: {},
    });

    const result = await resolveTotalsLive({ models, grain: "day", periodKey: "2026-10-13", now });

    expect(result.hits).toBe(22);
  });

  it("reads the stored aggregate for a sealed past day instead of summing hours", async () => {
    const now = new Date("2026-10-13T11:30:00Z");
    const models = makeModels({
      totalsByGrain: { day: { "2026-10-12": totalsItem("2026-10-12", "day", 999) } },
      markers: new Set(["day#2026-10-12"]),
      breakdownsByKey: {},
    });

    const result = await resolveTotalsLive({ models, grain: "day", periodKey: "2026-10-12", now });

    expect(result.hits).toBe(999);
  });

  it("partial month = stored day aggregates for finished days + the live current day; never reads hours for finished days", async () => {
    const now = new Date("2026-10-03T05:00:00Z");
    const days: Record<string, TotalsItem> = {
      "2026-10-01": totalsItem("2026-10-01", "day", 100),
      "2026-10-02": totalsItem("2026-10-02", "day", 200),
    };
    const hours: Record<string, TotalsItem> = {};
    for (let hour = 0; hour <= 5; hour += 1) {
      const key = `2026-10-03-${hour.toString().padStart(2, "0")}`;
      hours[key] = totalsItem(key, "hour", 3);
    }
    const spy: Spy = { hourQueries: [], dayQueries: [] };
    const models = makeModels(
      {
        totalsByGrain: { day: days, hour: hours },
        markers: new Set(["day#2026-10-01", "day#2026-10-02"]),
        breakdownsByKey: {},
      },
      spy,
    );

    const result = await resolveTotalsLive({ models, grain: "month", periodKey: "2026-10", now });

    // 100 + 200 (stored days) + 6*3 (current day from hours)
    expect(result.hits).toBe(318);
    // only ONE hourly query, and it is for the current day only
    expect(spy.hourQueries).toEqual(["2026-10-03-00..2026-10-03-05"]);
    // exactly one daily range query (the month's days), none per finished day
    expect(spy.dayQueries).toEqual(["2026-10-01..2026-10-31"]);
  });

  it("returns zeros when the current day has no ingested hours yet", async () => {
    const now = new Date("2026-10-13T00:30:00Z");
    const models = makeModels({ totalsByGrain: {}, markers: new Set(), breakdownsByKey: {} });

    const result = await resolveTotalsLive({ models, grain: "day", periodKey: "2026-10-13", now });

    expect(result.hits).toBe(0);
  });
});

describe("resolveBreakdownLive", () => {
  it("merges hourly breakdown rows for the current day by value", async () => {
    const now = new Date("2026-10-13T02:30:00Z");
    const models = makeModels({
      totalsByGrain: {},
      markers: new Set(),
      breakdownsByKey: {
        "country#hour#2026-10-13-00": [breakdownItem("/a", 5), breakdownItem("/b", 1)],
        "country#hour#2026-10-13-01": [breakdownItem("/a", 3)],
        "country#hour#2026-10-13-02": [breakdownItem("/b", 4)],
      },
    });

    const result = await resolveBreakdownLive({
      models,
      dimension: "country",
      grain: "day",
      periodKey: "2026-10-13",
      now,
    });

    const byValue = Object.fromEntries(result.map((row) => [row.value, row.hits]));
    expect(byValue["/a"]).toBe(8);
    expect(byValue["/b"]).toBe(5);
  });

  it("partial month breakdown merges stored day rows with the live current day", async () => {
    const now = new Date("2026-10-02T03:30:00Z");
    const models = makeModels({
      totalsByGrain: {},
      markers: new Set(["day#2026-10-01"]),
      breakdownsByKey: {
        "country#day#2026-10-01": [breakdownItem("/a", 50)],
        "country#hour#2026-10-02-00": [breakdownItem("/a", 1)],
        "country#hour#2026-10-02-01": [breakdownItem("/b", 2)],
        "country#hour#2026-10-02-02": [breakdownItem("/a", 1)],
        "country#hour#2026-10-02-03": [breakdownItem("/a", 1)],
      },
    });

    const result = await resolveBreakdownLive({
      models,
      dimension: "country",
      grain: "month",
      periodKey: "2026-10",
      now,
    });

    const byValue = Object.fromEntries(result.map((row) => [row.value, row.hits]));
    expect(byValue["/a"]).toBe(53);
    expect(byValue["/b"]).toBe(2);
  });
});

describe("classifyBucketState", () => {
  const now = new Date("2026-10-13T14:30:00Z");

  it("marks a past period with an applied marker as sealed", async () => {
    const models = makeModels({
      totalsByGrain: {},
      markers: new Set(["day#2026-10-12"]),
      breakdownsByKey: {},
    });
    const state = await classifyBucketState({
      models,
      grain: "day",
      periodKey: "2026-10-12",
      now,
      hasData: false,
    });
    expect(state).toBe("sealed");
  });

  it("marks the current period with data as partial", async () => {
    const models = makeModels({ totalsByGrain: {}, markers: new Set(), breakdownsByKey: {} });
    const state = await classifyBucketState({
      models,
      grain: "day",
      periodKey: "2026-10-13",
      now,
      hasData: true,
    });
    expect(state).toBe("partial");
  });

  it("marks an unsealed period with no data as pending", async () => {
    const models = makeModels({ totalsByGrain: {}, markers: new Set(), breakdownsByKey: {} });
    const state = await classifyBucketState({
      models,
      grain: "hour",
      periodKey: "2026-10-13-14",
      now,
      hasData: false,
    });
    expect(state).toBe("pending");
  });
});
