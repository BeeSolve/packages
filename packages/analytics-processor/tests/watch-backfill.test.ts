import { describe, expect, it } from "bun:test";

import { monthsBetween, parseWatchBackfillArgs } from "../command/watch-backfill.ts";

describe("parseWatchBackfillArgs", () => {
  it("parses a valid month range", () => {
    const args = parseWatchBackfillArgs(["--from", "2025-06", "--to", "2026-05"]);
    expect(args).toEqual({ from: "2025-06", to: "2026-05", concurrency: 2 });
  });

  it("parses an explicit concurrency", () => {
    const args = parseWatchBackfillArgs([
      "--from",
      "2025-06",
      "--to",
      "2026-05",
      "--concurrency",
      "4",
    ]);
    expect(args.concurrency).toBe(4);
  });

  it("throws when --from is missing", () => {
    expect(() => parseWatchBackfillArgs(["--to", "2026-05"])).toThrow(
      /requires --from <YYYY-MM> and --to <YYYY-MM>/,
    );
  });

  it("throws when --to is missing", () => {
    expect(() => parseWatchBackfillArgs(["--from", "2025-06"])).toThrow(
      /requires --from <YYYY-MM> and --to <YYYY-MM>/,
    );
  });

  it("throws on a malformed month missing the zero pad", () => {
    expect(() => parseWatchBackfillArgs(["--from", "2025-6", "--to", "2026-05"])).toThrow(
      /must be YYYY-MM/,
    );
  });

  it("throws on a month that includes a day", () => {
    expect(() => parseWatchBackfillArgs(["--from", "2025-06-01", "--to", "2026-05"])).toThrow(
      /must be YYYY-MM/,
    );
  });

  it("throws when from is after to", () => {
    expect(() => parseWatchBackfillArgs(["--from", "2026-05", "--to", "2025-06"])).toThrow(
      /--from must not be after --to/,
    );
  });

  it("throws on a non-positive concurrency", () => {
    expect(() =>
      parseWatchBackfillArgs(["--from", "2025-06", "--to", "2026-05", "--concurrency", "0"]),
    ).toThrow(/--concurrency must be a positive number/);
  });
});

describe("monthsBetween", () => {
  it("enumerates inclusive months across a year rollover", () => {
    expect(monthsBetween({ from: "2025-11", to: "2026-02" })).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns a single month when from equals to", () => {
    expect(monthsBetween({ from: "2026-03", to: "2026-03" })).toEqual(["2026-03"]);
  });
});
