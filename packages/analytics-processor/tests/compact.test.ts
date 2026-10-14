import { describe, expect, it } from "bun:test";

import {
  buildCompactSelect,
  buildInsert,
  buildSeedCtas,
  compactColumnMap,
  parseCompactArgs,
  planDateBatches,
} from "../command/compact.ts";

describe("planDateBatches", () => {
  it("returns a single batch for a range within one window", () => {
    expect(planDateBatches({ from: "2026-01-01", to: "2026-01-03" })).toEqual([
      { from: "2026-01-01", to: "2026-01-03" },
    ]);
  });

  it("caps each batch at four days so a statement opens at most 96 hour-partitions", () => {
    const batches = planDateBatches({ from: "2026-01-01", to: "2026-01-10" });
    expect(batches).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
      { from: "2026-01-09", to: "2026-01-10" },
    ]);
  });

  it("spans a month boundary correctly", () => {
    const batches = planDateBatches({ from: "2026-01-30", to: "2026-02-02" });
    expect(batches).toEqual([{ from: "2026-01-30", to: "2026-02-02" }]);
  });

  it("returns one batch when from equals to", () => {
    expect(planDateBatches({ from: "2026-05-14", to: "2026-05-14" })).toEqual([
      { from: "2026-05-14", to: "2026-05-14" },
    ]);
  });

  it("throws on a malformed date", () => {
    expect(() => planDateBatches({ from: "2026-5-14", to: "2026-05-20" })).toThrow(
      /must be YYYY-MM-DD/,
    );
  });

  it("throws when from is after to", () => {
    expect(() => planDateBatches({ from: "2026-05-20", to: "2026-05-14" })).toThrow(
      /must not be after/,
    );
  });
});

describe("buildCompactSelect", () => {
  const select = buildCompactSelect({
    sourceTable: "cf_logs_v1_backfill",
    batch: { from: "2026-01-01", to: "2026-01-04" },
  });

  it("renames every v1 column to its v2 name", () => {
    for (const { v1, v2 } of compactColumnMap) {
      expect(select).toContain(`${v1} AS ${v2}`);
    }
  });

  it("derives the four partition columns from the v1 date and time", () => {
    expect(select).toContain(`substr(CAST("date" AS varchar), 1, 4) AS year`);
    expect(select).toContain(`substr(CAST("date" AS varchar), 6, 2) AS month`);
    expect(select).toContain(`substr(CAST("date" AS varchar), 9, 2) AS day`);
    expect(select).toContain(`substr("time", 1, 2) AS hour`);
  });

  it("restricts to the batch date range on the v1 date column", () => {
    expect(select).toContain(`WHERE "date" BETWEEN DATE '2026-01-01' AND DATE '2026-01-04'`);
  });

  it("reads from the source table", () => {
    expect(select).toContain(`FROM "cf_logs_v1_backfill"`);
  });
});

describe("buildSeedCtas", () => {
  const ctas = buildSeedCtas({
    targetTable: "cf_logs_v1_compact",
    externalLocation: "s3://bucket/compact/v1",
    sourceTable: "cf_logs_v1_backfill",
    batch: { from: "2026-01-01", to: "2026-01-04" },
  });

  it("creates the target table", () => {
    expect(ctas).toContain(`CREATE TABLE "cf_logs_v1_compact"`);
  });

  it("writes Parquet partitioned by the hour-grain keys", () => {
    expect(ctas).toContain("format = 'PARQUET'");
    expect(ctas).toContain("partitioned_by = ARRAY['year', 'month', 'day', 'hour']");
  });

  it("forces one file per partition via a single bucket", () => {
    expect(ctas).toContain("bucketed_by = ARRAY['c_ip']");
    expect(ctas).toContain("bucket_count = 1");
  });

  it("normalizes the external location to a trailing slash", () => {
    expect(ctas).toContain("external_location = 's3://bucket/compact/v1/'");
  });

  it("embeds the projecting SELECT", () => {
    expect(ctas).toContain('"time" AS timestamp');
    expect(ctas).toContain(`FROM "cf_logs_v1_backfill"`);
  });
});

describe("buildInsert", () => {
  it("appends into the target table with the projecting SELECT", () => {
    const insert = buildInsert({
      targetTable: "cf_logs_v1_compact",
      sourceTable: "cf_logs_v1_backfill",
      batch: { from: "2026-01-05", to: "2026-01-08" },
    });
    expect(insert).toContain(`INSERT INTO "cf_logs_v1_compact"`);
    expect(insert).toContain(`WHERE "date" BETWEEN DATE '2026-01-05' AND DATE '2026-01-08'`);
    expect(insert).not.toContain("CREATE TABLE");
  });
});

describe("parseCompactArgs", () => {
  const base = [
    "--database",
    "cf_logs_db",
    "--source-table",
    "cf_logs_v1_backfill",
    "--target-table",
    "cf_logs_v1_compact",
    "--external-location",
    "s3://bucket/compact/v1/",
    "--workgroup",
    "primary",
    "--from",
    "2025-10-16",
    "--to",
    "2026-10-13",
  ];

  it("parses the full required flag set", () => {
    const args = parseCompactArgs(base);
    expect(args.database).toBe("cf_logs_db");
    expect(args.sourceTable).toBe("cf_logs_v1_backfill");
    expect(args.targetTable).toBe("cf_logs_v1_compact");
    expect(args.externalLocation).toBe("s3://bucket/compact/v1/");
    expect(args.workgroup).toBe("primary");
    expect(args.from).toBe("2025-10-16");
    expect(args.to).toBe("2026-10-13");
    expect(args.dropExisting).toBe(false);
  });

  it("parses the optional output location and drop-existing flag", () => {
    const args = parseCompactArgs([
      ...base,
      "--output-location",
      "s3://results/ctas/",
      "--drop-existing",
    ]);
    expect(args.outputLocation).toBe("s3://results/ctas/");
    expect(args.dropExisting).toBe(true);
  });

  it("throws listing every missing required flag", () => {
    expect(() => parseCompactArgs(["--database", "cf_logs_db"])).toThrow(/--source-table/);
  });
});
