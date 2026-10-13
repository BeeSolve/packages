import { describe, expect, it } from "bun:test";

import { buildHourlyQuery } from "../src/athena.ts";

describe("buildHourlyQuery", () => {
  const outputColumnAliases = [
    "AS status_value",
    "device",
    "AS path_value",
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
    "AS unique_ip_count",
  ];

  describe("v2 source", () => {
    const query = buildHourlyQuery({
      table: "cf_logs_v2_table",
      source: "v2",
      hourKey: "2026-02-14-09",
      topPaths: 100,
    });

    it("references the v2 table name passed in", () => {
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
      // just like v1 — but on the normalized (unquoted) column names.
      expect(query).toContain("CAST(sc_status AS integer) AS st");
      expect(query).toContain("CAST(sc_bytes AS bigint) AS scb");
      expect(query).toContain("CAST(cs_bytes AS bigint) AS csb");
      expect(query).toContain("CAST(time_taken AS double) AS tt");
    });

    it("projects the string columns bare in the inner projection", () => {
      expect(query).toContain("x_edge_result_type AS rt");
      expect(query).toContain("cs_uri_stem AS uri");
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
      expect(query).toContain("GROUP BY GROUPING SETS ((), (st), (device), (uri), (ip))");
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
  });

  describe("v1 source", () => {
    const query = buildHourlyQuery({
      table: "cf_logs_table",
      source: "v1",
      hourKey: "2026-02-14-09",
      topPaths: 100,
    });

    it("references the v1 table name passed in", () => {
      expect(query).toContain('FROM "cf_logs_table"');
    });

    it("predicates on the quoted date column and the time-hour", () => {
      expect(query).toContain(`"date" = DATE '2026-02-14'`);
      expect(query).toContain(`substr("time", 1, 2) = '09'`);
    });

    it("casts the string-typed numeric columns in the inner projection", () => {
      expect(query).toContain('CAST("sc-status" AS integer) AS st');
      expect(query).toContain('CAST("sc-bytes" AS bigint) AS scb');
      expect(query).toContain('CAST("cs-bytes" AS bigint) AS csb');
      expect(query).toContain('CAST("time-taken" AS double) AS tt');
    });

    it("projects the double-quoted legacy string columns bare in the inner projection", () => {
      expect(query).toContain('"cs-uri-stem" AS uri');
      expect(query).toContain('"c-ip" AS ip');
      expect(query).toContain('"x-edge-result-type" AS rt');
      expect(query).toContain('"cs(User-Agent)"');
    });

    it("wraps the scan in an inner subquery and groups over plain column references", () => {
      expect(query).toContain("FROM (");
      expect(query).toContain("GROUP BY GROUPING SETS ((), (st), (device), (uri), (ip))");
    });

    it("still computes percentiles over the inner alias", () => {
      expect(query).toContain("approx_percentile(tt, 0.5)");
      expect(query).toContain("approx_percentile(tt, 0.95)");
    });

    it("preserves every output column alias the result parser expects", () => {
      for (const alias of outputColumnAliases) {
        expect(query).toContain(alias);
      }
    });
  });

  it("threads topPaths through the builder without failing", () => {
    const query = buildHourlyQuery({
      table: "cf_logs_v2_table",
      source: "v2",
      hourKey: "2026-01-01-00",
      topPaths: 25,
    });
    expect(query).toContain("GROUPING SETS");
    expect(query).toContain("year = '2026'");
    expect(query).toContain("hour = '00'");
  });
});
