import { describe, expect, it } from "bun:test";

import {
  buildDayUniquesQuery,
  buildDayUrlsQuery,
  buildHourlyQuery,
  buildMonthUniquesQuery,
  cacheCountExpressions,
  runDayUniques,
  runDayUrls,
  runMonthUniques,
} from "../src/athena.ts";

function athenaFake(rows: Array<Array<string | undefined>>) {
  const sends: Array<string> = [];
  const dataRows = [
    { Data: [{ VarCharValue: "header" }] },
    ...rows.map((cells) => ({ Data: cells.map((cell) => ({ VarCharValue: cell })) })),
  ];
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }) => {
    const name = command.constructor.name;
    sends.push(name);
    if (name === "StartQueryExecutionCommand") {
      return { QueryExecutionId: "q1" };
    }
    if (name === "GetQueryExecutionCommand") {
      return { QueryExecution: { Status: { State: "SUCCEEDED" } } };
    }
    if (name === "GetQueryResultsCommand") {
      return { ResultSet: { Rows: dataRows } };
    }
    return {};
  };
  return { send, sends };
}

describe("buildHourlyQuery", () => {
  const outputColumnAliases = [
    "AS status_value",
    "device",
    "AS ip_value",
    "AS hits",
    "AS success",
    "AS errors",
    "AS errors4xx",
    "AS errors5xx",
    "AS bytes_sent",
    "AS bytes_received",
    "AS p50_time_taken",
    "AS p95_time_taken",
    "AS cache_hits",
    "AS cache_misses",
    "AS cache_errors",
    "AS unique_ip_count",
  ];

  const query = buildHourlyQuery({
    table: "cf_logs_v2_table",
    hourKey: "2026-02-14-09",
    topPaths: 100,
  });

  it("references the table name passed in", () => {
    expect(query).toContain('FROM "cf_logs_v2_table"');
  });

  it("predicates on the Hive partition columns derived from the hourKey", () => {
    expect(query).toContain("year = '2026'");
    expect(query).toContain("month = '02'");
    expect(query).toContain("day = '14'");
    expect(query).toContain("hour = '09'");
  });

  it("casts the string-typed v2 Parquet numeric columns in the inner projection", () => {
    // v2 Parquet stores every field as BINARY/string, so numeric columns must be cast
    // on the normalized (unquoted) column names.
    expect(query).toContain("CAST(sc_status AS integer) AS st");
    expect(query).toContain("CAST(sc_bytes AS bigint) AS scb");
    expect(query).toContain("CAST(cs_bytes AS bigint) AS csb");
    expect(query).toContain("CAST(time_taken AS double) AS tt");
  });

  it("projects the string columns bare in the inner projection", () => {
    expect(query).toContain("x_edge_result_type AS rt");
    expect(query).toContain("c_ip AS ip");
  });

  it("aggregates in the outer query over plain inner column references, not casts", () => {
    // The outer aggregation references the inner aliases; the raw Parquet column names
    // and casts live only in the inner projection.
    expect(query).toContain("sum(scb) AS bytes_sent");
    expect(query).toContain("sum(csb) AS bytes_received");
    expect(query).toContain("approx_percentile(tt, 0.5) AS p50_time_taken");
    expect(query).toContain("approx_percentile(tt, 0.95) AS p95_time_taken");
    expect(query).toContain("count(DISTINCT ip) AS unique_ip_count");
  });

  it("wraps the scan in an inner subquery and groups over plain column references", () => {
    expect(query).toContain("FROM (");
    // GROUPING SETS references plain inner column names, never a CASE expression or the
    // `device` select alias from the outer query (Athena rejects both).
    expect(query).toContain("GROUP BY GROUPING SETS ((), (st), (device), (ip))");
    expect(query).not.toMatch(/GROUPING SETS \([^)]*CASE/);
  });

  it("keeps the device classification in the inner projection", () => {
    expect(query).toContain("CASE");
    expect(query).toContain("'mobile'");
    expect(query).toContain("'bot'");
    expect(query).toContain("AS device");
  });

  it("preserves every output column alias the result parser expects", () => {
    for (const alias of outputColumnAliases) {
      expect(query).toContain(alias);
    }
  });

  it("emits the three additive cache-count CASE sums over the result type", () => {
    expect(query).toContain(
      "sum(CASE WHEN rt IN ('Hit','RefreshHit') THEN 1 ELSE 0 END) AS cache_hits",
    );
    expect(query).toContain("sum(CASE WHEN rt = 'Miss' THEN 1 ELSE 0 END) AS cache_misses");
    expect(query).toContain(
      "sum(CASE WHEN rt IN ('Error','LimitExceeded','CapacityExceeded') THEN 1 ELSE 0 END) AS cache_errors",
    );
  });

  it("threads topPaths through the builder without failing", () => {
    const customQuery = buildHourlyQuery({
      table: "cf_logs_v2_table",
      hourKey: "2026-01-01-00",
      topPaths: 25,
    });
    expect(customQuery).toContain("GROUPING SETS");
    expect(customQuery).toContain("year = '2026'");
    expect(customQuery).toContain("hour = '00'");
  });
});

describe("cacheCountExpressions", () => {
  it("builds the three additive cache CASE sums over the given result-type column", () => {
    const expressions = cacheCountExpressions("x_edge_result_type");
    expect(expressions.hits).toBe(
      "sum(CASE WHEN x_edge_result_type IN ('Hit','RefreshHit') THEN 1 ELSE 0 END)",
    );
    expect(expressions.misses).toBe("sum(CASE WHEN x_edge_result_type = 'Miss' THEN 1 ELSE 0 END)");
    expect(expressions.errors).toBe(
      "sum(CASE WHEN x_edge_result_type IN ('Error','LimitExceeded','CapacityExceeded') THEN 1 ELSE 0 END)",
    );
  });
});

describe("buildDayUniquesQuery", () => {
  const query = buildDayUniquesQuery({ table: "cf_logs_v2_table", dayKey: "2026-02-14" });

  it("selects approx_distinct over the client-ip column", () => {
    expect(query).toContain("approx_distinct(c_ip) AS uniques");
  });

  it("predicates on the day partition columns", () => {
    expect(query).toContain("year = '2026' AND month = '02' AND day = '14'");
    expect(query).toContain('FROM "cf_logs_v2_table"');
  });

  it("rejects a malformed dayKey", () => {
    expect(() => buildDayUniquesQuery({ table: "t", dayKey: "2026-02" })).toThrow("Invalid dayKey");
  });
});

describe("buildMonthUniquesQuery", () => {
  const query = buildMonthUniquesQuery({ table: "cf_logs_v2_table", monthKey: "2026-02" });

  it("selects approx_distinct over the whole month's partitions", () => {
    expect(query).toContain("approx_distinct(c_ip) AS uniques");
    expect(query).toContain("year = '2026' AND month = '02'");
    expect(query).not.toContain("day =");
  });

  it("rejects a malformed monthKey", () => {
    expect(() => buildMonthUniquesQuery({ table: "t", monthKey: "2026-02-14" })).toThrow(
      "Invalid monthKey",
    );
  });
});

describe("buildDayUrlsQuery", () => {
  const query = buildDayUrlsQuery({ table: "cf_logs_v2_table", dayKey: "2026-02-14" });

  it("selects the distinct slash-collapsed uri as url", () => {
    expect(query).toContain("SELECT DISTINCT");
    expect(query).toContain("AS url");
    expect(query).toContain("year = '2026' AND month = '02' AND day = '14'");
  });
});

describe("runDayUniques / runMonthUniques", () => {
  it("parses the single scalar uniques cell for a day", async () => {
    const athena = athenaFake([["4217"]]);
    const result = await runDayUniques({
      athena,
      database: "db",
      table: "t",
      workgroup: "wg",
      dayKey: "2026-02-14",
    });
    expect(result).toBe(4217);
  });

  it("parses the single scalar uniques cell for a month", async () => {
    const athena = athenaFake([["90210"]]);
    const result = await runMonthUniques({
      athena,
      database: "db",
      table: "t",
      workgroup: "wg",
      monthKey: "2026-02",
    });
    expect(result).toBe(90210);
  });

  it("treats a missing row as zero uniques", async () => {
    const athena = athenaFake([]);
    const result = await runDayUniques({
      athena,
      database: "db",
      table: "t",
      workgroup: "wg",
      dayKey: "2026-02-14",
    });
    expect(result).toBe(0);
  });
});

describe("runDayUrls", () => {
  it("returns every non-empty distinct url row", async () => {
    const athena = athenaFake([["/a"], ["/b"], [""], [undefined]]);
    const result = await runDayUrls({
      athena,
      database: "db",
      table: "t",
      workgroup: "wg",
      dayKey: "2026-02-14",
    });
    expect(result).toEqual(["/a", "/b"]);
  });
});
