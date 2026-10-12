import { describe, expect, it } from "bun:test";

import { sumBreakdown, sumTotals, topNWithOther } from "../src/reduce.ts";
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
      }),
      totalsItem({
        hits: 50,
        success: 40,
        errors: 10,
        errors4xx: 6,
        errors5xx: 4,
        bytesSent: 250,
        bytesReceived: 100,
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

describe("topNWithOther", () => {
  it("keeps the top n and folds the remainder into __other__", () => {
    const result = topNWithOther({
      items: [
        { value: "/a", hits: 100, bytes: 1000 },
        { value: "/b", hits: 50, bytes: 500 },
        { value: "/c", hits: 20, bytes: 200 },
        { value: "/d", hits: 10, bytes: 100 },
      ],
      n: 2,
      otherValue: "__other__",
    });

    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ value: "/a", hits: 100, bytes: 1000 });
    expect(result[1]).toEqual({ value: "/b", hits: 50, bytes: 500 });
    expect(result[2]).toEqual({ value: "__other__", hits: 30, bytes: 300 });
  });

  it("returns the items unchanged when they fit within n", () => {
    const result = topNWithOther({
      items: [
        { value: "/a", hits: 100, bytes: 1000 },
        { value: "/b", hits: 50, bytes: 500 },
      ],
      n: 5,
      otherValue: "__other__",
    });

    expect(result.length).toBe(2);
    expect(result.some((row) => row.value === "__other__")).toBe(false);
  });
});
