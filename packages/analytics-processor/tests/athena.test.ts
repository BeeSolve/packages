import { describe, expect, it } from "bun:test";

import { buildHourlyQuery } from "../src/athena.ts";

describe("buildHourlyQuery", () => {
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

    it("uses the normalized Parquet column names without casts", () => {
      expect(query).toContain("sc_status");
      expect(query).toContain("c_ip");
      expect(query).toContain("cs_uri_stem");
      expect(query).toContain("time_taken");
      expect(query).toContain("x_edge_result_type");
      expect(query).not.toContain("CAST(");
    });

    it("computes percentiles and uses GROUPING SETS", () => {
      expect(query).toContain("approx_percentile(time_taken, 0.5)");
      expect(query).toContain("approx_percentile(time_taken, 0.95)");
      expect(query).toContain("GROUPING SETS");
    });

    it("includes an inline device case expression and a distinct ip count", () => {
      expect(query).toContain("CASE");
      expect(query).toContain("'mobile'");
      expect(query).toContain("'bot'");
      expect(query).toContain("count(DISTINCT c_ip)");
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

    it("casts the string-typed numeric columns and double-quotes legacy names", () => {
      expect(query).toContain('CAST("sc-status" AS integer)');
      expect(query).toContain('CAST("sc-bytes" AS bigint)');
      expect(query).toContain('CAST("cs-bytes" AS bigint)');
      expect(query).toContain('CAST("time-taken" AS double)');
      expect(query).toContain('"cs-uri-stem"');
      expect(query).toContain('"c-ip"');
      expect(query).toContain('"cs(User-Agent)"');
      expect(query).toContain('"x-edge-result-type"');
    });

    it("still computes percentiles and uses GROUPING SETS", () => {
      expect(query).toContain("approx_percentile");
      expect(query).toContain("GROUPING SETS");
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
