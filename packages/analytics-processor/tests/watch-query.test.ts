import { describe, expect, it } from "bun:test";

import {
  buildWatchHourlyQuery,
  buildWatchMonthlyQuery,
  runWatchHourlyQuery,
  runWatchMonthlyQuery,
} from "../src/watch.ts";

const canonicalUriFragment =
  "CASE WHEN length(cs_uri_stem) > 1 AND substr(cs_uri_stem, -1) = '/' THEN substr(cs_uri_stem, 1, length(cs_uri_stem) - 1) ELSE cs_uri_stem END";

function expectMetricColumns(query: string): void {
  expect(query).toContain("count(*) AS hits");
  expect(query).toContain("sum(CAST(sc_bytes AS bigint)) AS bytes_sent");
  expect(query).toContain(
    "sum(CASE WHEN x_edge_result_type IN ('Hit','RefreshHit') THEN 1 ELSE 0 END) AS cache_hits",
  );
  expect(query).toContain(
    "sum(CASE WHEN x_edge_result_type = 'Miss' THEN 1 ELSE 0 END) AS cache_misses",
  );
  expect(query).toContain(
    "sum(CASE WHEN x_edge_result_type IN ('Error','LimitExceeded','CapacityExceeded') THEN 1 ELSE 0 END) AS cache_errors",
  );
  expect(query).toContain(
    "sum(CASE WHEN x_edge_result_type IN ('Hit','RefreshHit') THEN CAST(sc_bytes AS bigint) ELSE 0 END) AS bytes_saved",
  );
  expect(query).toContain(
    "sum(CASE WHEN CAST(sc_status AS integer) BETWEEN 400 AND 599 THEN 1 ELSE 0 END) AS errors",
  );
  expect(query).toContain(
    "sum(CASE WHEN CAST(sc_status AS integer) BETWEEN 300 AND 399 THEN 1 ELSE 0 END) AS redirects",
  );
}

describe("buildWatchHourlyQuery", () => {
  it("restricts an exact match with equality on the canonical URI and no GROUP BY", () => {
    const query = buildWatchHourlyQuery({
      table: "cf_logs_v2_table",
      hourKey: "2026-05-14-09",
      matcher: "/blog",
      mode: "exact",
    });

    expect(query).toContain('FROM "cf_logs_v2_table"');
    expect(query).toContain("year = '2026'");
    expect(query).toContain("month = '05'");
    expect(query).toContain("day = '14'");
    expect(query).toContain("hour = '09'");
    expect(query).toContain(`${canonicalUriFragment} = '/blog'`);
    expect(query).not.toContain("GROUP BY");
    expect(query).not.toContain("path_value");
    expectMetricColumns(query);
  });

  it("restricts a group match with a prefix LIKE and no GROUP BY", () => {
    const query = buildWatchHourlyQuery({
      table: "t",
      hourKey: "2026-05-14-09",
      matcher: "/blog/",
      mode: "group",
    });

    expect(query).toContain("cs_uri_stem LIKE '/blog/%'");
    expect(query).not.toContain("GROUP BY");
    expect(query).not.toContain("path_value");
    expectMetricColumns(query);
  });

  it("restricts a split match with a prefix LIKE and groups by the canonical URI", () => {
    const query = buildWatchHourlyQuery({
      table: "t",
      hourKey: "2026-05-14-09",
      matcher: "/blog/",
      mode: "split",
    });

    expect(query).toContain("cs_uri_stem LIKE '/blog/%'");
    expect(query).toContain(`${canonicalUriFragment} AS path_value`);
    expect(query).toContain(`GROUP BY ${canonicalUriFragment}`);
    expect(query).not.toContain("day_value");
    expectMetricColumns(query);
  });

  it("doubles single quotes in the matcher", () => {
    const query = buildWatchHourlyQuery({
      table: "t",
      hourKey: "2026-05-14-09",
      matcher: "/o'brien",
      mode: "exact",
    });
    expect(query).toContain("= '/o''brien'");
  });

  it("throws on a malformed hourKey", () => {
    expect(() =>
      buildWatchHourlyQuery({ table: "t", hourKey: "2026-05-14", matcher: "/blog", mode: "exact" }),
    ).toThrow("Invalid hourKey");
  });
});

describe("buildWatchMonthlyQuery", () => {
  it("restricts to the month and groups by day for exact/group", () => {
    const query = buildWatchMonthlyQuery({
      table: "t",
      monthKey: "2026-05",
      matcher: "/blog",
      mode: "exact",
    });
    expect(query).toContain("year = '2026'");
    expect(query).toContain("month = '05'");
    expect(query).toContain("day AS day_value");
    expect(query).toContain("GROUP BY day");
    expect(query).not.toContain("path_value");
    expectMetricColumns(query);
  });

  it("groups by day and canonical URI for split", () => {
    const query = buildWatchMonthlyQuery({
      table: "t",
      monthKey: "2026-05",
      matcher: "/blog/",
      mode: "split",
    });
    expect(query).toContain("day AS day_value");
    expect(query).toContain(`${canonicalUriFragment} AS path_value`);
    expect(query).toContain(`GROUP BY day, ${canonicalUriFragment}`);
    expectMetricColumns(query);
  });

  it("throws on a malformed monthKey", () => {
    expect(() =>
      buildWatchMonthlyQuery({ table: "t", monthKey: "2026-5", matcher: "/blog", mode: "exact" }),
    ).toThrow("Invalid monthKey");
  });
});

type Cell = { readonly VarCharValue?: string };
type AthenaRow = { readonly Data: Array<Cell> };

function dataRow(values: Array<string | undefined>): AthenaRow {
  return { Data: values.map((value) => ({ VarCharValue: value })) };
}

function makeAthena({ header, rows }: { header: AthenaRow; rows: Array<AthenaRow> }) {
  const client = {
    send: async (command: { constructor: { name: string } }) => {
      const name = command.constructor.name;
      if (name === "StartQueryExecutionCommand") return { QueryExecutionId: "qid-1" };
      if (name === "GetQueryExecutionCommand") {
        return { QueryExecution: { Status: { State: "SUCCEEDED" } } };
      }
      if (name === "GetQueryResultsCommand") {
        return { ResultSet: { Rows: [header, ...rows] } };
      }
      throw new Error(`unexpected athena command ${name}`);
    },
  };
  return { client };
}

const hourlyHeader: AthenaRow = {
  Data: [
    { VarCharValue: "hits" },
    { VarCharValue: "bytes_sent" },
    { VarCharValue: "cache_hits" },
    { VarCharValue: "cache_misses" },
    { VarCharValue: "cache_errors" },
    { VarCharValue: "bytes_saved" },
    { VarCharValue: "errors" },
    { VarCharValue: "redirects" },
  ],
};

const splitHourlyHeader: AthenaRow = {
  Data: [{ VarCharValue: "path_value" }, ...hourlyHeader.Data],
};

describe("runWatchHourlyQuery", () => {
  it("maps a single aggregate row to one pathless bucket for exact", async () => {
    const { client } = makeAthena({
      header: hourlyHeader,
      rows: [dataRow(["10", "2000", "6", "3", "1", "1200", "2", "1"])],
    });

    const result = await runWatchHourlyQuery({
      athena: client,
      database: "db",
      table: "t",
      workgroup: "wg",
      hourKey: "2026-05-14-09",
      matcher: "/blog",
      mode: "exact",
    });

    expect(result).toEqual([
      {
        path: undefined,
        hits: 10,
        bytesSent: 2000,
        cacheHits: 6,
        cacheMisses: 3,
        cacheErrors: 1,
        bytesSaved: 1200,
        errors: 2,
        redirects: 1,
      },
    ]);
  });

  it("maps each split row to a path bucket", async () => {
    const { client } = makeAthena({
      header: splitHourlyHeader,
      rows: [
        dataRow(["/blog/a", "4", "800", "2", "2", "0", "500", "0", "0"]),
        dataRow(["/blog/b", "6", "1200", "4", "1", "1", "700", "1", "0"]),
      ],
    });

    const result = await runWatchHourlyQuery({
      athena: client,
      database: "db",
      table: "t",
      workgroup: "wg",
      hourKey: "2026-05-14-09",
      matcher: "/blog/",
      mode: "split",
    });

    expect(result.map((row) => row.path)).toEqual(["/blog/a", "/blog/b"]);
    expect(result[0]?.hits).toBe(4);
    expect(result[1]?.bytesSaved).toBe(700);
  });

  it("returns an empty array for a zero-row result", async () => {
    const { client } = makeAthena({ header: hourlyHeader, rows: [] });

    const result = await runWatchHourlyQuery({
      athena: client,
      database: "db",
      table: "t",
      workgroup: "wg",
      hourKey: "2026-05-14-09",
      matcher: "/blog",
      mode: "group",
    });

    expect(result).toEqual([]);
  });
});

describe("runWatchMonthlyQuery", () => {
  const monthlyHeader: AthenaRow = {
    Data: [{ VarCharValue: "day_value" }, ...hourlyHeader.Data],
  };
  const splitMonthlyHeader: AthenaRow = {
    Data: [{ VarCharValue: "day_value" }, { VarCharValue: "path_value" }, ...hourlyHeader.Data],
  };

  it("reshapes day rows into a single bucket for group", async () => {
    const { client } = makeAthena({
      header: monthlyHeader,
      rows: [
        dataRow(["1", "5", "500", "3", "1", "1", "300", "0", "0"]),
        dataRow(["2", "3", "300", "2", "1", "0", "200", "1", "1"]),
      ],
    });

    const result = await runWatchMonthlyQuery({
      athena: client,
      database: "db",
      table: "t",
      workgroup: "wg",
      monthKey: "2026-05",
      matcher: "/blog/",
      mode: "group",
    });

    expect(result.length).toBe(1);
    expect(result[0]).toEqual({
      matcher: "/blog/",
      mode: "group",
      path: undefined,
      month: "2026-05",
      days: { "01": 5, "02": 3 },
      hits: 8,
      bytesSent: 800,
      cacheHits: 5,
      cacheMisses: 2,
      cacheErrors: 1,
      bytesSaved: 500,
      errors: 1,
      redirects: 1,
    });
  });

  it("reshapes day+path rows into one bucket per path for split", async () => {
    const { client } = makeAthena({
      header: splitMonthlyHeader,
      rows: [
        dataRow(["1", "/blog/a", "5", "500", "3", "1", "1", "300", "0", "0"]),
        dataRow(["2", "/blog/a", "2", "200", "1", "1", "0", "100", "0", "0"]),
        dataRow(["1", "/blog/b", "7", "700", "4", "2", "1", "400", "1", "1"]),
      ],
    });

    const result = await runWatchMonthlyQuery({
      athena: client,
      database: "db",
      table: "t",
      workgroup: "wg",
      monthKey: "2026-05",
      matcher: "/blog/",
      mode: "split",
    });

    const blogA = result.find((bucket) => bucket.path === "/blog/a");
    const blogB = result.find((bucket) => bucket.path === "/blog/b");
    expect(blogA?.days).toEqual({ "01": 5, "02": 2 });
    expect(blogA?.hits).toBe(7);
    expect(blogB?.days).toEqual({ "01": 7 });
    expect(blogB?.hits).toBe(7);
  });

  it("returns an empty array for a zero-row result", async () => {
    const { client } = makeAthena({ header: monthlyHeader, rows: [] });

    const result = await runWatchMonthlyQuery({
      athena: client,
      database: "db",
      table: "t",
      workgroup: "wg",
      monthKey: "2026-05",
      matcher: "/blog",
      mode: "exact",
    });

    expect(result).toEqual([]);
  });
});
