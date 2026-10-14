import { describe, expect, it } from "bun:test";

import { monthsBetween, parseSitemapBackfillArgs } from "../command/sitemap-backfill.ts";

describe("parseSitemapBackfillArgs", () => {
  it("parses a valid month range with explicit source v2", () => {
    const args = parseSitemapBackfillArgs([
      "--from",
      "2025-06",
      "--to",
      "2026-05",
      "--source",
      "v2",
    ]);
    expect(args).toEqual({ from: "2025-06", to: "2026-05", source: "v2", concurrency: 2 });
  });

  it("defaults source to v2 when omitted", () => {
    const args = parseSitemapBackfillArgs(["--from", "2025-06", "--to", "2026-05"]);
    expect(args.source).toBe("v2");
  });

  it("accepts source v1", () => {
    const args = parseSitemapBackfillArgs([
      "--from",
      "2025-06",
      "--to",
      "2026-05",
      "--source",
      "v1",
    ]);
    expect(args.source).toBe("v1");
  });

  it("throws on an invalid source", () => {
    expect(() =>
      parseSitemapBackfillArgs(["--from", "2025-06", "--to", "2026-05", "--source", "foo"]),
    ).toThrow(/--source must be v1 or v2/);
  });

  it("carries an optional sitemap url", () => {
    const args = parseSitemapBackfillArgs([
      "--from",
      "2025-06",
      "--to",
      "2026-05",
      "--sitemap-url",
      "https://example.com/sitemap.xml",
    ]);
    expect(args.sitemapUrl).toBe("https://example.com/sitemap.xml");
  });

  it("throws when --from is missing", () => {
    expect(() => parseSitemapBackfillArgs(["--to", "2026-05"])).toThrow(
      /requires --from <YYYY-MM> and --to <YYYY-MM>/,
    );
  });

  it("throws when --to is missing", () => {
    expect(() => parseSitemapBackfillArgs(["--from", "2025-06"])).toThrow(
      /requires --from <YYYY-MM> and --to <YYYY-MM>/,
    );
  });

  it("throws on a malformed month missing the zero pad", () => {
    expect(() => parseSitemapBackfillArgs(["--from", "2025-6", "--to", "2026-05"])).toThrow(
      /must be YYYY-MM/,
    );
  });

  it("throws on a month that includes a day", () => {
    expect(() => parseSitemapBackfillArgs(["--from", "2025-06-01", "--to", "2026-05"])).toThrow(
      /must be YYYY-MM/,
    );
  });

  it("throws when from is after to", () => {
    expect(() => parseSitemapBackfillArgs(["--from", "2026-05", "--to", "2025-06"])).toThrow(
      /--from must not be after --to/,
    );
  });

  it("throws on a non-positive concurrency", () => {
    expect(() =>
      parseSitemapBackfillArgs(["--from", "2025-06", "--to", "2026-05", "--concurrency", "0"]),
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
