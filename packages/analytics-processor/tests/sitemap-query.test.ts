import { describe, expect, it } from "bun:test";

import {
  buildSitemapHourlyQuery,
  buildSitemapMonthlyQuery,
  runSitemapHourlyQuery,
  runSitemapMonthlyQuery,
} from "../src/sitemap.ts";

const canonicalUriFragment =
  "CASE WHEN length(cs_uri_stem) > 1 AND substr(cs_uri_stem, -1) = '/' THEN substr(cs_uri_stem, 1, length(cs_uri_stem) - 1) ELSE cs_uri_stem END";

describe("buildSitemapHourlyQuery", () => {
  const query = buildSitemapHourlyQuery({
    table: "cf_logs_v2_table",
    hourKey: "2026-05-14-09",
    paths: ["/blog", "/blog/how-to"],
  });

  it("references the table name passed in", () => {
    expect(query).toContain('FROM "cf_logs_v2_table"');
  });

  it("restricts to the hour via the Hive year/month/day/hour partitions", () => {
    expect(query).toContain("year = '2026'");
    expect(query).toContain("month = '05'");
    expect(query).toContain("day = '14'");
    expect(query).toContain("hour = '09'");
  });

  it("groups by the canonical path", () => {
    expect(query).toContain(`GROUP BY ${canonicalUriFragment}`);
    expect(query).not.toContain("day_value");
  });

  it("uses the canonical-uri collapse in both the SELECT/GROUP BY and the WHERE IN", () => {
    expect(query).toContain(`${canonicalUriFragment} AS path_value`);
    expect(query).toContain(`${canonicalUriFragment} IN (`);
  });

  it("single-quotes each path in the IN list", () => {
    expect(query).toContain(`IN ('/blog', '/blog/how-to')`);
  });

  it("counts hits", () => {
    expect(query).toContain("count(*) AS hits");
  });

  it("doubles single quotes in IN-list values", () => {
    const quoted = buildSitemapHourlyQuery({
      table: "t",
      hourKey: "2026-05-14-09",
      paths: ["/o'brien"],
    });
    expect(quoted).toContain(`IN ('/o''brien')`);
  });

  it("throws on a malformed hourKey", () => {
    expect(() =>
      buildSitemapHourlyQuery({
        table: "t",
        hourKey: "2026-05-14",
        paths: ["/blog"],
      }),
    ).toThrow("Invalid hourKey");
  });

  it("yields a no-rows statement when paths is empty", () => {
    const empty = buildSitemapHourlyQuery({
      table: "t",
      hourKey: "2026-05-14-09",
      paths: [],
    });
    expect(empty).toContain("WHERE 1 = 0");
  });
});

describe("runSitemapHourlyQuery", () => {
  it("short-circuits to an empty result without touching Athena when paths is empty", async () => {
    const athena = {
      send() {
        throw new Error("Athena should not be called for empty paths");
      },
    };

    const result = await runSitemapHourlyQuery({
      athena,
      database: "db",
      table: "t",
      workgroup: "wg",
      hourKey: "2026-05-14-09",
      paths: [],
    });

    expect(result).toEqual([]);
  });
});

describe("buildSitemapMonthlyQuery", () => {
  it("restricts to the month via the Hive year/month partitions and groups by day + path", () => {
    const query = buildSitemapMonthlyQuery({
      table: "cf_logs_v2_table",
      monthKey: "2026-05",
      paths: ["/blog", "/blog/how-to"],
    });
    expect(query).toContain("year = '2026'");
    expect(query).toContain("month = '05'");
    expect(query).toContain("day AS day_value");
    expect(query).toContain(`GROUP BY day, ${canonicalUriFragment}`);
    expect(query).toContain(`IN ('/blog', '/blog/how-to')`);
  });

  it("throws on a malformed monthKey", () => {
    expect(() =>
      buildSitemapMonthlyQuery({ table: "t", monthKey: "2026-5", paths: ["/blog"] }),
    ).toThrow("Invalid monthKey");
  });

  it("yields a no-rows statement when paths is empty", () => {
    const query = buildSitemapMonthlyQuery({
      table: "t",
      monthKey: "2026-05",
      paths: [],
    });
    expect(query).toContain("WHERE 1 = 0");
  });
});

describe("runSitemapMonthlyQuery", () => {
  it("short-circuits to an empty result without touching Athena when paths is empty", async () => {
    const athena = {
      send() {
        throw new Error("Athena should not be called for empty paths");
      },
    };

    const result = await runSitemapMonthlyQuery({
      athena,
      database: "db",
      table: "t",
      workgroup: "wg",
      monthKey: "2026-05",
      paths: [],
    });

    expect(result).toEqual([]);
  });
});
