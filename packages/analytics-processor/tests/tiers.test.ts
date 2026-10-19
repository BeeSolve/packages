import { describe, expect, it } from "bun:test";

import { AppliedMarkers } from "../src/appliedMarkers.ts";
import { Breakdowns } from "../src/breakdowns.ts";
import { tierMarkerSegment, tierSegment } from "../src/keys.ts";
import {
  realTierPredicate,
  sitemapPaths,
  tierPredicate,
  watchTierPredicate,
} from "../src/tierPredicates.ts";
import { Totals } from "../src/totals.ts";
import type { WatchEntry } from "../src/watch.ts";

const noopDynamo = { send: async (): Promise<Record<string, unknown>> => ({}) };

function keyOf(update: { readonly Update: { readonly Key?: Record<string, unknown> } }): string {
  const pk = update.Update.Key?.pk;
  if (typeof pk !== "string") throw new Error("expected string pk");
  return pk;
}

function firstUpdate<Value>(updates: Array<Value>): Value {
  const first = updates[0];
  if (first == null) throw new Error("expected at least one update");
  return first;
}

function entry(overrides: Partial<WatchEntry>): WatchEntry {
  return {
    matcher: "/",
    mode: "exact",
    source: "sitemap",
    status: "active",
    firstSeen: "2026-01-01",
    ...overrides,
  };
}

describe("tier key segments", () => {
  it("all tier produces empty segments (byte-identical to legacy keys)", () => {
    expect(tierSegment("all")).toBe("");
    expect(tierMarkerSegment("all")).toBe("");
  });

  it("real/watch tiers insert their segment", () => {
    expect(tierSegment("real")).toBe("#real");
    expect(tierSegment("watch")).toBe("#watch");
    expect(tierMarkerSegment("real")).toBe("real-");
    expect(tierMarkerSegment("watch")).toBe("watch-");
  });
});

describe("Totals tier keys", () => {
  const totals = new Totals({ dynamo: noopDynamo, tableName: "t" });

  it("defaults to the legacy all-tier key", () => {
    const update = totals.buildHourlyUpdate({
      item: baseTotalsItem(),
      ttl: 1,
    });
    expect(keyOf(update)).toBe("totals#hour");
  });

  it("namespaces the real tier", () => {
    const update = totals.buildHourlyUpdate({ item: baseTotalsItem(), ttl: 1, tier: "real" });
    expect(keyOf(update)).toBe("totals#real#hour");
  });

  it("namespaces the watch tier aggregate", () => {
    const update = totals.buildAggregateUpdate({
      grain: "day",
      item: baseTotalsItem(),
      tier: "watch",
    });
    expect(keyOf(update)).toBe("totals#watch#day");
  });
});

describe("Breakdowns tier keys", () => {
  const breakdowns = new Breakdowns({ dynamo: noopDynamo, tableName: "t" });

  it("defaults to the legacy all-tier key", () => {
    const updates = breakdowns.buildUpdates({
      dimension: "status",
      grain: "hour",
      periodKey: "2026-02-14-09",
      items: [{ value: "200", hits: 1, bytes: 2 }],
    });
    expect(keyOf(firstUpdate(updates))).toBe("breakdown#status#hour#2026-02-14-09");
  });

  it("namespaces the real tier", () => {
    const updates = breakdowns.buildUpdates({
      dimension: "status",
      grain: "hour",
      periodKey: "2026-02-14-09",
      items: [{ value: "200", hits: 1, bytes: 2 }],
      tier: "real",
    });
    expect(keyOf(firstUpdate(updates))).toBe("breakdown#real#status#hour#2026-02-14-09");
  });
});

describe("AppliedMarkers tier keys", () => {
  const markers = new AppliedMarkers({ dynamo: noopDynamo, tableName: "t" });

  it("defaults to the legacy all-tier marker", () => {
    const put = markers.buildMarkerPut({ grain: "hour", periodKey: "2026-02-14-09" });
    expect(put.Put.Item?.pk).toBe("applied#hour#2026-02-14-09");
  });

  it("namespaces the real/watch markers with a tier prefix on the grain", () => {
    expect(
      markers.buildMarkerPut({ grain: "hour", periodKey: "2026-02-14-09", tier: "real" }).Put.Item
        ?.pk,
    ).toBe("applied#real-hour#2026-02-14-09");
    expect(
      markers.buildMarkerPut({ grain: "day", periodKey: "2026-02-14", tier: "watch" }).Put.Item?.pk,
    ).toBe("applied#watch-day#2026-02-14");
  });
});

describe("tier predicates", () => {
  it("real tier matches 2xx text/html via LIKE", () => {
    expect(realTierPredicate).toContain("LIKE 'text/html%'");
    expect(realTierPredicate).toContain("BETWEEN 200 AND 299");
    expect(realTierPredicate).not.toContain("399");
  });

  it("sitemapPaths keeps only active sitemap entries, de-duped and sorted", () => {
    const entries = [
      entry({ matcher: "/blog" }),
      entry({ matcher: "/" }),
      entry({ matcher: "/blog" }),
      entry({ matcher: "/stopped", status: "stopped" }),
      entry({ matcher: "/manual", source: "manual" }),
    ];
    expect(sitemapPaths(entries)).toEqual(["/", "/blog"]);
  });

  it("watch predicate builds a canonical IN list over active sitemap paths", () => {
    const predicate = watchTierPredicate([entry({ matcher: "/" }), entry({ matcher: "/blog" })]);
    expect(predicate).toContain("IN ('/', '/blog')");
  });

  it("watch predicate escapes single quotes in paths", () => {
    const predicate = watchTierPredicate([entry({ matcher: "/it's" })]);
    expect(predicate).toContain("'/it''s'");
  });

  it("watch predicate is undefined for an empty sitemap set", () => {
    expect(watchTierPredicate([])).toBeUndefined();
    expect(watchTierPredicate([entry({ status: "stopped" })])).toBeUndefined();
  });

  it("tierPredicate dispatches by tier", () => {
    expect(tierPredicate({ tier: "all", sitemapEntries: [] })).toBeUndefined();
    expect(tierPredicate({ tier: "real", sitemapEntries: [] })).toBe(realTierPredicate);
    expect(tierPredicate({ tier: "watch", sitemapEntries: [entry({})] })).toContain("IN (");
  });
});

function baseTotalsItem() {
  return {
    timeKey: "2026-02-14-09",
    hits: 1,
    success: 1,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    bytesSent: 10,
    bytesReceived: 5,
    cacheHits: 0,
    cacheMisses: 0,
    cacheErrors: 0,
  };
}
