import { describe, expect, it } from "bun:test";

import { parseBackfillArgs } from "../command/backfill.ts";

const range = ["--from", "2026-01-01T00:00:00Z", "--to", "2026-01-02T00:00:00Z"];

describe("parseBackfillArgs tiers and force", () => {
  it("defaults to all three tiers and no force", () => {
    const args = parseBackfillArgs(range);
    expect(args.tiers).toEqual(["all", "real", "watch"]);
    expect(args.force).toBe(false);
  });

  it("parses a single --tier", () => {
    const args = parseBackfillArgs([...range, "--tier", "real"]);
    expect(args.tiers).toEqual(["real"]);
  });

  it("parses repeated --tier flags and de-dupes", () => {
    const args = parseBackfillArgs([
      ...range,
      "--tier",
      "real",
      "--tier",
      "watch",
      "--tier",
      "real",
    ]);
    expect(args.tiers).toEqual(["real", "watch"]);
  });

  it("parses --force", () => {
    const args = parseBackfillArgs([...range, "--force"]);
    expect(args.force).toBe(true);
  });

  it("throws on an unknown tier", () => {
    expect(() => parseBackfillArgs([...range, "--tier", "bogus"])).toThrow(/--tier must be one of/);
  });
});
