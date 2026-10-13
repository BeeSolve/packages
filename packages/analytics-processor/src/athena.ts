import type { AthenaClient } from "@aws-sdk/client-athena";
import {
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";

import type { AppliedSource } from "./keys.ts";
import type { BreakdownRow } from "./reduce.ts";
import { topNWithOther } from "./reduce.ts";

/**
 * Normalized Glue/Parquet column names the processor's hourly query reads. Pass
 * these as `CloudFrontAccessLoggingSettings`' `athena.recordFields` to deliver
 * only the columns the processor needs, shrinking Parquet and cutting Athena cost.
 */
export const requiredRecordFields = [
  "timestamp",
  "sc_status",
  "sc_bytes",
  "cs_bytes",
  "time_taken",
  "x_edge_result_type",
  "x_edge_detailed_result_type",
  "cs_uri_stem",
  "c_ip",
  "cs_user_agent",
] as const;

export interface AthenaColumnMap {
  readonly status: string;
  readonly bytesSent: string;
  readonly bytesReceived: string;
  readonly timeTaken: string;
  readonly resultType: string;
  readonly detailedResultType: string;
  readonly uriStem: string;
  readonly clientIp: string;
  readonly userAgent: string;
  readonly timestamp: string;
}

/**
 * Per-source SQL column references — the single source of truth for how each
 * logical field is addressed in each table.
 *
 * v2 is the Parquet Glue table: Athena normalizes Parquet column names to
 * lowercase with hyphens folded to underscores. CloudFront standard-logging-v2
 * stores every Parquet field as BINARY/string, so the Glue schema types every
 * column as string and numeric references must cast explicitly — just like v1,
 * but on the normalized (unquoted) column names.
 *
 * v1 is the legacy tab-delimited LazySimpleSerDe table: its column names contain
 * hyphens and parentheses, so they must be double-quoted, and every numeric
 * column is typed as string in the Glue schema, so arithmetic references must
 * cast explicitly.
 */
export const columnMaps: Record<AppliedSource, AthenaColumnMap> = {
  v2: {
    status: "CAST(sc_status AS integer)",
    bytesSent: "CAST(sc_bytes AS bigint)",
    bytesReceived: "CAST(cs_bytes AS bigint)",
    timeTaken: "CAST(time_taken AS double)",
    resultType: "x_edge_result_type",
    detailedResultType: "x_edge_detailed_result_type",
    uriStem: "cs_uri_stem",
    clientIp: "c_ip",
    userAgent: "cs_user_agent",
    timestamp: "timestamp",
  },
  v1: {
    status: 'CAST("sc-status" AS integer)',
    bytesSent: 'CAST("sc-bytes" AS bigint)',
    bytesReceived: 'CAST("cs-bytes" AS bigint)',
    timeTaken: 'CAST("time-taken" AS double)',
    resultType: '"x-edge-result-type"',
    detailedResultType: '"x-edge-detailed-result-type"',
    uriStem: '"cs-uri-stem"',
    clientIp: '"c-ip"',
    userAgent: '"cs(User-Agent)"',
    timestamp: '"time"',
  },
};

interface HourParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
}

export function hourKeyParts(hourKey: string): HourParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(hourKey);
  if (match == null) {
    throw new Error(`Invalid hourKey: ${hourKey}`);
  }
  const [, year, month, day, hour] = match;
  if (year == null || month == null || day == null || hour == null) {
    throw new Error(`Invalid hourKey: ${hourKey}`);
  }
  return { year, month, day, hour };
}

function deviceCaseExpression(userAgentColumn: string): string {
  return [
    "CASE",
    `WHEN lower(${userAgentColumn}) LIKE '%bot%' OR lower(${userAgentColumn}) LIKE '%crawler%' OR lower(${userAgentColumn}) LIKE '%spider%' OR lower(${userAgentColumn}) LIKE '%slurp%' THEN 'bot'`,
    `WHEN lower(${userAgentColumn}) LIKE '%mobi%' OR lower(${userAgentColumn}) LIKE '%android%' OR lower(${userAgentColumn}) LIKE '%iphone%' OR lower(${userAgentColumn}) LIKE '%ipad%' THEN 'mobile'`,
    `WHEN lower(${userAgentColumn}) LIKE '%windows nt%' OR lower(${userAgentColumn}) LIKE '%macintosh%' OR lower(${userAgentColumn}) LIKE '%x11%' OR lower(${userAgentColumn}) LIKE '%linux%' THEN 'desktop'`,
    "ELSE 'other'",
    "END",
  ].join(" ");
}

function predicateFor({
  source,
  hourKey,
  columns,
}: {
  source: AppliedSource;
  hourKey: string;
  columns: AthenaColumnMap;
}): string {
  const parts = hourKeyParts(hourKey);
  if (source === "v2") {
    return [
      `year = '${parts.year}'`,
      `month = '${parts.month}'`,
      `day = '${parts.day}'`,
      `hour = '${parts.hour}'`,
    ].join(" AND ");
  }
  return [
    `"date" = DATE '${parts.year}-${parts.month}-${parts.day}'`,
    `substr(${columns.timestamp}, 1, 2) = '${parts.hour}'`,
  ].join(" AND ");
}

/**
 * Builds ONE Athena statement that scans a single UTC hour and returns, in a
 * single pass, the grand-total aggregate row plus per-status, per-device,
 * per-path, and per-ip grouped rows via GROUPING SETS.
 *
 * Why no per-set LIMIT: GROUPING SETS cannot apply an independent LIMIT to each
 * set within one statement. Rather than fragment the scan, the full grouped
 * rows are returned and {@link runHourlyAthenaQuery} applies the `topPaths`
 * top-N (folding the remainder into `__other__`) downstream via
 * {@link topNWithOther}. `topPaths` is still threaded through this builder so
 * callers have a single source of truth for the value.
 */
export function buildHourlyQuery({
  table,
  source,
  hourKey,
  topPaths: _topPaths,
}: {
  table: string;
  source: AppliedSource;
  hourKey: string;
  topPaths: number;
}): string {
  const columns = columnMaps[source];
  const predicate = predicateFor({ source, hourKey, columns });
  const device = deviceCaseExpression(columns.userAgent);

  // The inner subquery projects plain columns: the numeric casts and the device
  // classification are resolved here into simple aliases (st/scb/csb/tt/rt/uri/ip/device).
  // The outer query then aggregates over those plain column references. This is required
  // because Athena/Trino rejects a GROUPING SETS element that is a select alias or a
  // computed expression (COLUMN_NOT_FOUND / INVALID_COLUMN_REFERENCE) — the element must
  // be a plain column reference, which only the inner projection can provide.
  const inner = [
    "  SELECT",
    `    ${columns.status} AS st,`,
    `    ${columns.bytesSent} AS scb,`,
    `    ${columns.bytesReceived} AS csb,`,
    `    ${columns.timeTaken} AS tt,`,
    `    ${columns.resultType} AS rt,`,
    `    ${columns.uriStem} AS uri,`,
    `    ${columns.clientIp} AS ip,`,
    `    ${device} AS device`,
    `  FROM "${table}"`,
    `  WHERE ${predicate}`,
  ].join("\n");

  const groupingSets = ["()", "(st)", "(device)", "(uri)", "(ip)"].join(", ");

  return [
    "SELECT",
    "  st AS status_value,",
    "  device,",
    "  uri AS path_value,",
    "  ip AS ip_value,",
    "  count(*) AS hits,",
    "  sum(CASE WHEN st BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS success,",
    "  sum(CASE WHEN st BETWEEN 400 AND 599 THEN 1 ELSE 0 END) AS errors,",
    "  sum(CASE WHEN st BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS errors4xx,",
    "  sum(CASE WHEN st BETWEEN 500 AND 599 THEN 1 ELSE 0 END) AS errors5xx,",
    "  sum(scb) AS bytes_sent,",
    "  sum(csb) AS bytes_received,",
    "  approx_percentile(tt, 0.5) AS p50_time_taken,",
    "  approx_percentile(tt, 0.95) AS p95_time_taken,",
    "  sum(CASE WHEN rt = 'Hit' THEN 1 ELSE 0 END) AS cache_hits,",
    "  count(DISTINCT ip) AS unique_ip_count",
    "FROM (",
    inner,
    ")",
    `GROUP BY GROUPING SETS (${groupingSets})`,
  ].join("\n");
}

export interface HourlyAthenaTotals {
  readonly hits: number;
  readonly success: number;
  readonly errors: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly p50TimeTaken: number;
  readonly p95TimeTaken: number;
  readonly cacheHitRatio: number;
  readonly uniqueIpCount: number;
}

export interface HourlyAthenaResult {
  readonly totals: HourlyAthenaTotals;
  readonly byStatus: Array<BreakdownRow>;
  readonly byDevice: Array<BreakdownRow>;
  readonly byPath: Array<BreakdownRow>;
  readonly topIps: Array<{ ip: string; hits: number }>;
}

interface ResultRow {
  readonly status: string | undefined;
  readonly device: string | undefined;
  readonly path: string | undefined;
  readonly ip: string | undefined;
  readonly hits: number;
  readonly success: number;
  readonly errors: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly p50TimeTaken: number;
  readonly p95TimeTaken: number;
  readonly cacheHits: number;
  readonly uniqueIpCount: number;
}

function toNumber(value: string | undefined): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function cellValue(value: string | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  return value;
}

function parseRow(columns: Array<string | undefined>): ResultRow {
  return {
    status: cellValue(columns[0]),
    device: cellValue(columns[1]),
    path: cellValue(columns[2]),
    ip: cellValue(columns[3]),
    hits: toNumber(columns[4]),
    success: toNumber(columns[5]),
    errors: toNumber(columns[6]),
    errors4xx: toNumber(columns[7]),
    errors5xx: toNumber(columns[8]),
    bytesSent: toNumber(columns[9]),
    bytesReceived: toNumber(columns[10]),
    p50TimeTaken: toNumber(columns[11]),
    p95TimeTaken: toNumber(columns[12]),
    cacheHits: toNumber(columns[13]),
    uniqueIpCount: toNumber(columns[14]),
  };
}

function assembleResult({
  rows,
  topPaths,
}: {
  rows: Array<ResultRow>;
  topPaths: number;
}): HourlyAthenaResult {
  const totalsRow = rows.find(
    (row) => row.status == null && row.device == null && row.path == null && row.ip == null,
  );

  const totals: HourlyAthenaTotals =
    totalsRow == null
      ? {
          hits: 0,
          success: 0,
          errors: 0,
          errors4xx: 0,
          errors5xx: 0,
          bytesSent: 0,
          bytesReceived: 0,
          p50TimeTaken: 0,
          p95TimeTaken: 0,
          cacheHitRatio: 0,
          uniqueIpCount: 0,
        }
      : {
          hits: totalsRow.hits,
          success: totalsRow.success,
          errors: totalsRow.errors,
          errors4xx: totalsRow.errors4xx,
          errors5xx: totalsRow.errors5xx,
          bytesSent: totalsRow.bytesSent,
          bytesReceived: totalsRow.bytesReceived,
          p50TimeTaken: totalsRow.p50TimeTaken,
          p95TimeTaken: totalsRow.p95TimeTaken,
          cacheHitRatio: totalsRow.hits === 0 ? 0 : totalsRow.cacheHits / totalsRow.hits,
          uniqueIpCount: totalsRow.uniqueIpCount,
        };

  const byStatus: Array<BreakdownRow> = rows
    .filter((row) => row.status != null && row.device == null && row.path == null && row.ip == null)
    .map((row) => ({ value: row.status ?? "", hits: row.hits, bytes: row.bytesSent }));

  const byDevice: Array<BreakdownRow> = rows
    .filter((row) => row.device != null && row.status == null && row.path == null && row.ip == null)
    .map((row) => ({ value: row.device ?? "", hits: row.hits, bytes: row.bytesSent }));

  const byPathAll: Array<BreakdownRow> = rows
    .filter((row) => row.path != null && row.status == null && row.device == null && row.ip == null)
    .map((row) => ({ value: row.path ?? "", hits: row.hits, bytes: row.bytesSent }));

  const byPath = topNWithOther({ items: byPathAll, n: topPaths, otherValue: "__other__" });

  const topIps = rows
    .filter((row) => row.ip != null && row.status == null && row.device == null && row.path == null)
    .map((row) => ({ ip: row.ip ?? "", hits: row.hits }))
    .sort((left, right) => right.hits - left.hits)
    .slice(0, topPaths);

  return { totals, byStatus, byDevice, byPath, topIps };
}

async function waitForQuery({
  athena,
  queryExecutionId,
}: {
  athena: Pick<AthenaClient, "send">;
  queryExecutionId: string;
}): Promise<void> {
  let delayMs = 250;
  const maxDelayMs = 5000;

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

async function fetchRows({
  athena,
  queryExecutionId,
}: {
  athena: Pick<AthenaClient, "send">;
  queryExecutionId: string;
}): Promise<Array<ResultRow>> {
  const rows: Array<ResultRow> = [];
  let nextToken: string | undefined;
  let isFirstPage = true;

  do {
    const results = await athena.send(
      new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId, NextToken: nextToken }),
    );

    const resultRows = results.ResultSet?.Rows ?? [];
    const dataRows = isFirstPage ? resultRows.slice(1) : resultRows;

    for (const dataRow of dataRows) {
      const cells = (dataRow.Data ?? []).map((datum) => datum.VarCharValue);
      rows.push(parseRow(cells));
    }

    nextToken = results.NextToken;
    isFirstPage = false;
  } while (nextToken != null);

  return rows;
}

export async function runHourlyAthenaQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  source,
  hourKey,
  topPaths,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  source: AppliedSource;
  hourKey: string;
  topPaths: number;
}): Promise<HourlyAthenaResult> {
  const queryString = buildHourlyQuery({ table, source, hourKey, topPaths });

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
  const rows = await fetchRows({ athena, queryExecutionId });

  return assembleResult({ rows, topPaths });
}
