import { describe, expect, it } from "bun:test";

import { sumBreakdown, sumTotals } from "../src/reduce.ts";
import type { TotalsInput } from "../src/totals.ts";

function totalsItem(overrides: Partial<TotalsInput>): TotalsInput {
  return {
    timeKey: "2026-02-14-09",
    hits: 0,
    success: 0,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    bytesSent: 0,
    bytesReceived: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheErrors: 0,
    ...overrides,
  };
}

describe("sumTotals", () => {
  it("adds additive numerics across items", () => {
    const result = sumTotals([
      totalsItem({
        hits: 100,
        success: 90,
        errors: 10,
        errors4xx: 7,
        errors5xx: 3,
        bytesSent: 500,
        bytesReceived: 200,
        cacheHits: 70,
        cacheMisses: 20,
        cacheErrors: 10,
      }),
      totalsItem({
        hits: 50,
        success: 40,
        errors: 10,
        errors4xx: 6,
        errors5xx: 4,
        bytesSent: 250,
        bytesReceived: 100,
        cacheHits: 30,
        cacheMisses: 15,
        cacheErrors: 5,
      }),
    ]);

    expect(result).toEqual({
      hits: 150,
      success: 130,
      errors: 20,
      errors4xx: 13,
      errors5xx: 7,
      bytesSent: 750,
      bytesReceived: 300,
      cacheHits: 100,
      cacheMisses: 35,
      cacheErrors: 15,
    });
  });

  it("returns zeros for an empty list", () => {
    expect(sumTotals([])).toEqual({
      hits: 0,
      success: 0,
      errors: 0,
      errors4xx: 0,
      errors5xx: 0,
      bytesSent: 0,
      bytesReceived: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheErrors: 0,
    });
  });
});

describe("sumBreakdown", () => {
  it("groups duplicate values and sums hits and bytes", () => {
    const result = sumBreakdown([
      { value: "/a", hits: 10, bytes: 100 },
      { value: "/b", hits: 5, bytes: 50 },
      { value: "/a", hits: 3, bytes: 30 },
    ]);

    const byValue = Object.fromEntries(result.map((row) => [row.value, row]));
    expect(byValue["/a"]).toEqual({ value: "/a", hits: 13, bytes: 130 });
    expect(byValue["/b"]).toEqual({ value: "/b", hits: 5, bytes: 50 });
    expect(result.length).toBe(2);
  });
});
