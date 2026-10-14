import { AthenaClient } from "@aws-sdk/client-athena";
import { GetQueryExecutionCommand, StartQueryExecutionCommand } from "@aws-sdk/client-athena";

/**
 * One-time (and reusable) compaction of a v1 LazySimpleSerDe CloudFront access
 * log table into a v2-shaped Parquet table.
 *
 * Why: v1 logs are ~tens of thousands of tiny gzip files. Athena/Trino issues
 * one-or-more S3 GET per file, so a single hour query fans out across the whole
 * table and the cost scales with FILE COUNT, not bytes scanned. Compacting into
 * hour-partitioned Parquet with one file per partition collapses a full-table
 * scan down to ~one object per hour, and renaming the columns to the v2 schema
 * makes the compacted table a drop-in replacement for the live v2 Glue table —
 * which is what lets the processor drop its entire v1 code path.
 *
 * The compacted table is written as Parquet, partitioned by
 * `year/month/day/hour`, with `bucket_count = 1` so Trino emits exactly one file
 * per partition.
 */

/**
 * Normalized v2 column names, in the fixed projection order the compaction
 * SELECT emits. Every v1 source column (quoted, hyphenated) maps to exactly one.
 */
export const compactColumnMap: ReadonlyArray<{ readonly v1: string; readonly v2: string }> = [
  { v1: '"time"', v2: "timestamp" },
  { v1: '"sc-status"', v2: "sc_status" },
  { v1: '"sc-bytes"', v2: "sc_bytes" },
  { v1: '"cs-bytes"', v2: "cs_bytes" },
  { v1: '"time-taken"', v2: "time_taken" },
  { v1: '"x-edge-result-type"', v2: "x_edge_result_type" },
  { v1: '"x-edge-detailed-result-type"', v2: "x_edge_detailed_result_type" },
  { v1: '"cs-uri-stem"', v2: "cs_uri_stem" },
  { v1: '"c-ip"', v2: "c_ip" },
  { v1: '"cs(User-Agent)"', v2: "cs_user_agent" },
] as const;

/**
 * Column used purely as the single bucketing key. Any column works; the point
 * is `bucket_count = 1`, which forces Trino to write one bucket file per
 * partition instead of one-per-writer-task.
 */
const bucketColumn = "c_ip";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Max distinct hour-partitions one Athena statement may open as write targets.
 * Trino caps concurrent open writers at 100; partitioning opens one writer per
 * hour-partition. 24 hours/day => 4 days = 96 partitions stays safely under.
 */
const maxPartitionsPerStatement = 96;
const hoursPerDay = 24;
const maxDaysPerBatch = Math.floor(maxPartitionsPerStatement / hoursPerDay);

export interface CompactArgs {
  readonly database: string;
  readonly sourceTable: string;
  readonly targetTable: string;
  readonly externalLocation: string;
  readonly workgroup: string;
  readonly outputLocation?: string;
  readonly from: string;
  readonly to: string;
  readonly dropExisting: boolean;
}

export interface DateBatch {
  readonly from: string;
  readonly to: string;
}

/**
 * The inner SELECT projecting v1 columns to v2 names plus the four derived
 * partition columns, restricted to `[batch.from, batch.to]` inclusive on the v1
 * `"date"` column. Shared by the seed CTAS and every INSERT so the projection is
 * defined exactly once.
 */
export function buildCompactSelect({
  sourceTable,
  batch,
}: {
  sourceTable: string;
  batch: DateBatch;
}): string {
  const projections = compactColumnMap.map((entry) => `  ${entry.v1} AS ${entry.v2}`);

  const partitionProjections = [
    '  substr(CAST("date" AS varchar), 1, 4) AS year',
    '  substr(CAST("date" AS varchar), 6, 2) AS month',
    '  substr(CAST("date" AS varchar), 9, 2) AS day',
    '  substr("time", 1, 2) AS hour',
  ];

  return [
    "SELECT",
    [...projections, ...partitionProjections].join(",\n"),
    `FROM "${sourceTable}"`,
    `WHERE "date" BETWEEN DATE '${batch.from}' AND DATE '${batch.to}'`,
  ].join("\n");
}

/**
 * The seed `CREATE TABLE ... AS` statement. Declares the Parquet format, the
 * hour-partition keys, and `bucket_count = 1` (one file per partition), and
 * populates the first batch of days.
 */
export function buildSeedCtas({
  targetTable,
  externalLocation,
  sourceTable,
  batch,
}: {
  targetTable: string;
  externalLocation: string;
  sourceTable: string;
  batch: DateBatch;
}): string {
  return [
    `CREATE TABLE "${targetTable}"`,
    "WITH (",
    `  external_location = '${normalizeLocation(externalLocation)}',`,
    "  format = 'PARQUET',",
    "  parquet_compression = 'SNAPPY',",
    "  partitioned_by = ARRAY['year', 'month', 'day', 'hour'],",
    `  bucketed_by = ARRAY['${bucketColumn}'],`,
    "  bucket_count = 1",
    ") AS",
    buildCompactSelect({ sourceTable, batch }),
  ].join("\n");
}

/**
 * An `INSERT INTO ... SELECT` statement appending one batch to the already-seeded
 * target table. The partition/bucket layout is inherited from the table.
 */
export function buildInsert({
  targetTable,
  sourceTable,
  batch,
}: {
  targetTable: string;
  sourceTable: string;
  batch: DateBatch;
}): string {
  return [`INSERT INTO "${targetTable}"`, buildCompactSelect({ sourceTable, batch })].join("\n");
}

/**
 * Split an inclusive `[from, to]` date range (both `YYYY-MM-DD`) into
 * consecutive batches of at most {@link maxDaysPerBatch} days, so each resulting
 * statement opens at most {@link maxPartitionsPerStatement} hour-partitions.
 */
export function planDateBatches({ from, to }: { from: string; to: string }): Array<DateBatch> {
  if (!datePattern.test(from) || !datePattern.test(to)) {
    throw new Error(`compact --from/--to must be YYYY-MM-DD, got from=${from} to=${to}`);
  }

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`compact --from/--to must be valid dates, got from=${from} to=${to}`);
  }
  if (start > end) {
    throw new Error("compact --from must not be after --to");
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const batches: Array<DateBatch> = [];
  let cursor = start;
  while (cursor <= end) {
    const batchEnd = Math.min(cursor + (maxDaysPerBatch - 1) * dayMs, end);
    batches.push({ from: toDateString(cursor), to: toDateString(batchEnd) });
    cursor = batchEnd + dayMs;
  }
  return batches;
}

function toDateString(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function normalizeLocation(location: string): string {
  return location.endsWith("/") ? location : `${location}/`;
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value == null || value === "") {
    throw new Error(
      `compact requires --${name} — e.g. bun run compact -- --database cf_logs_db --source-table cf_logs_v1_backfill --target-table cf_logs_v1_compact --external-location s3://bucket/compact/v1/ --workgroup primary --output-location s3://results/ctas/ --from 2025-10-16 --to 2026-10-13`,
    );
  }
  return value;
}

export function parseCompactArgs(argv: Array<string>): CompactArgs {
  const flags: Record<string, string> = {};
  let dropExisting = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--drop-existing") {
      dropExisting = true;
      continue;
    }
    if (token != null && token.startsWith("--")) {
      flags[token.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    }
  }

  return {
    database: requireFlag(flags, "database"),
    sourceTable: requireFlag(flags, "source-table"),
    targetTable: requireFlag(flags, "target-table"),
    externalLocation: requireFlag(flags, "external-location"),
    workgroup: requireFlag(flags, "workgroup"),
    outputLocation: flags["output-location"],
    from: requireFlag(flags, "from"),
    to: requireFlag(flags, "to"),
    dropExisting,
  };
}

async function waitForQuery({
  athena,
  queryExecutionId,
}: {
  athena: Pick<AthenaClient, "send">;
  queryExecutionId: string;
}): Promise<void> {
  let delayMs = 500;
  const maxDelayMs = 10000;

  while (true) {
    const execution = await athena.send(
      new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }),
    );
    const state = execution.QueryExecution?.Status?.State;

    if (state === "SUCCEEDED") return;
    if (state === "FAILED" || state === "CANCELLED") {
      const reason = execution.QueryExecution?.Status?.StateChangeReason ?? "unknown reason";
      throw new Error(`Athena query ${state}: ${reason}`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
}

async function runStatement({
  athena,
  database,
  workgroup,
  outputLocation,
  queryString,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  workgroup: string;
  outputLocation?: string;
  queryString: string;
}): Promise<void> {
  const started = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: queryString,
      QueryExecutionContext: { Database: database },
      WorkGroup: workgroup,
      ResultConfiguration: outputLocation == null ? undefined : { OutputLocation: outputLocation },
    }),
  );

  const queryExecutionId = started.QueryExecutionId;
  if (queryExecutionId == null) {
    throw new Error("Athena StartQueryExecution returned no QueryExecutionId");
  }

  await waitForQuery({ athena, queryExecutionId });
}

/**
 * Run the full compaction: optionally drop the existing target, seed the Parquet
 * table from the first <=4-day batch via CTAS, then append every remaining batch
 * with INSERT. Each statement opens at most {@link maxPartitionsPerStatement}
 * hour-partitions so Trino never trips the 100-open-writers limit.
 */
export async function runCompact({
  athena,
  args,
}: {
  athena: Pick<AthenaClient, "send">;
  args: CompactArgs;
}): Promise<{ statements: number; batches: number }> {
  const batches = planDateBatches({ from: args.from, to: args.to });
  if (batches.length === 0) {
    throw new Error("compact: no date batches to process");
  }

  if (args.dropExisting) {
    console.log(`compact: dropping existing table "${args.targetTable}"`);
    await runStatement({
      athena,
      database: args.database,
      workgroup: args.workgroup,
      outputLocation: args.outputLocation,
      queryString: `DROP TABLE IF EXISTS "${args.targetTable}"`,
    });
  }

  const [seedBatch, ...rest] = batches;
  if (seedBatch == null) {
    throw new Error("compact: no seed batch");
  }

  console.log(
    `compact: ${batches.length} batches (<=${maxDaysPerBatch} days each), source "${args.sourceTable}" -> target "${args.targetTable}"`,
  );

  console.log(`compact: seed CTAS ${seedBatch.from}..${seedBatch.to}`);
  await runStatement({
    athena,
    database: args.database,
    workgroup: args.workgroup,
    outputLocation: args.outputLocation,
    queryString: buildSeedCtas({
      targetTable: args.targetTable,
      externalLocation: args.externalLocation,
      sourceTable: args.sourceTable,
      batch: seedBatch,
    }),
  });

  let index = 0;
  for (const batch of rest) {
    index += 1;
    console.log(`compact: insert ${index}/${rest.length} ${batch.from}..${batch.to}`);
    await runStatement({
      athena,
      database: args.database,
      workgroup: args.workgroup,
      outputLocation: args.outputLocation,
      queryString: buildInsert({
        targetTable: args.targetTable,
        sourceTable: args.sourceTable,
        batch,
      }),
    });
  }

  console.log(`compact: done, ${batches.length} statements`);
  return { statements: batches.length, batches: batches.length };
}

export async function main(): Promise<void> {
  const athena = new AthenaClient();
  const args = parseCompactArgs(process.argv.slice(2));
  await runCompact({ athena, args });
}

if (import.meta.main) {
  await main();
}
