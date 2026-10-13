import { describe, expect, it } from "bun:test";

import type { BreakdownItem } from "../src/breakdowns.ts";
import type { ResolveModels } from "../src/resolveLive.ts";
import { resolveBreakdownLive, resolveTotalsLive } from "../src/resolveLive.ts";
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
  };
}

function breakdownItem(value: string, hits: number): BreakdownItem {
  return {
    pk: "breakdown#path#hour#x",
    sk: value,
    dimension: "path",
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

function makeModels(store: Store): ResolveModels {
  return {
    totals: {
      queryWindow: async ({ grain, startKey, endKey }) => {
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

    const result = await resolveTotalsLive({
      models,
      grain: "day",
      periodKey: "2026-10-13",
      now,
    });

    expect(result.hits).toBe(22);
  });

  it("reads the stored aggregate for a sealed past day instead of summing hours", async () => {
    const now = new Date("2026-10-13T11:30:00Z");
    const models = makeModels({
      totalsByGrain: { day: { "2026-10-12": totalsItem("2026-10-12", "day", 999) } },
      markers: new Set(["day#2026-10-12"]),
      breakdownsByKey: {},
    });

    const result = await resolveTotalsLive({
      models,
      grain: "day",
      periodKey: "2026-10-12",
      now,
    });

    expect(result.hits).toBe(999);
  });

  it("folds the current month down through sealed days plus the live current day", async () => {
    const now = new Date("2026-10-02T05:00:00Z");
    const days: Record<string, TotalsItem> = {
      "2026-10-01": totalsItem("2026-10-01", "day", 100),
    };
    const hours: Record<string, TotalsItem> = {};
    for (let hour = 0; hour <= 5; hour += 1) {
      const key = `2026-10-02-${hour.toString().padStart(2, "0")}`;
      hours[key] = totalsItem(key, "hour", 3);
    }
    const models = makeModels({
      totalsByGrain: { day: days, hour: hours },
      markers: new Set(["day#2026-10-01"]),
      breakdownsByKey: {},
    });

    const result = await resolveTotalsLive({
      models,
      grain: "month",
      periodKey: "2026-10",
      now,
    });

    expect(result.hits).toBe(118);
  });

  it("returns zeros when the current day has no ingested hours yet", async () => {
    const now = new Date("2026-10-13T00:30:00Z");
    const models = makeModels({
      totalsByGrain: {},
      markers: new Set(),
      breakdownsByKey: {},
    });

    const result = await resolveTotalsLive({
      models,
      grain: "day",
      periodKey: "2026-10-13",
      now,
    });

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
        "path#hour#2026-10-13-00": [breakdownItem("/a", 5), breakdownItem("/b", 1)],
        "path#hour#2026-10-13-01": [breakdownItem("/a", 3)],
        "path#hour#2026-10-13-02": [breakdownItem("/b", 4)],
      },
    });

    const result = await resolveBreakdownLive({
      models,
      dimension: "path",
      grain: "day",
      periodKey: "2026-10-13",
      now,
    });

    const byValue = Object.fromEntries(result.map((row) => [row.value, row.hits]));
    expect(byValue["/a"]).toBe(8);
    expect(byValue["/b"]).toBe(5);
  });
});
