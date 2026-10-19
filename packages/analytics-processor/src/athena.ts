import type { AthenaClient } from "@aws-sdk/client-athena";
import {
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";

import type { BreakdownRow } from "./reduce.ts";
import { canonicalUriExpr, toCount } from "./sql.ts";

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
  "sc_content_type",
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
  readonly contentType: string;
}

/**
 * SQL column references for the v2 Parquet Glue table — the single source of
 * truth for how each logical field is addressed.
 *
 * Athena normalizes Parquet column names to lowercase with hyphens folded to
 * underscores. CloudFront standard-logging-v2 stores every Parquet field as
 * BINARY/string, so the Glue schema types every column as string and numeric
 * references must cast explicitly.
 *
 * The v1 log format is no longer read directly: legacy v1 logs are compacted
 * into this same v2 shape via {@link ../command/compact.ts} before processing,
 * so there is exactly one column map.
 */
export const columnMap: AthenaColumnMap = {
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
  contentType: "sc_content_type",
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

interface DayParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

export function dayKeyParts(dayKey: string): DayParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (match == null) {
    throw new Error(`Invalid dayKey: ${dayKey}`);
  }
  const [, year, month, day] = match;
  if (year == null || month == null || day == null) {
    throw new Error(`Invalid dayKey: ${dayKey}`);
  }
  return { year, month, day };
}

interface MonthParts {
  readonly year: string;
  readonly month: string;
}

export function monthKeyParts(monthKey: string): MonthParts {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (match == null) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }
  const [, year, month] = match;
  if (year == null || month == null) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }
  return { year, month };
}

export interface CacheCountExpressions {
  readonly hits: string;
  readonly misses: string;
  readonly errors: string;
}

/**
 * The three additive cache-count CASE SUM expressions over a result-type column.
 * Shared so the hourly query and the watch query address CloudFront's
 * `x_edge_result_type` values identically.
 */
export function cacheCountExpressions(resultTypeColumn: string): CacheCountExpressions {
  return {
    hits: `sum(CASE WHEN ${resultTypeColumn} IN ('Hit','RefreshHit') THEN 1 ELSE 0 END)`,
    misses: `sum(CASE WHEN ${resultTypeColumn} = 'Miss' THEN 1 ELSE 0 END)`,
    errors: `sum(CASE WHEN ${resultTypeColumn} IN ('Error','LimitExceeded','CapacityExceeded') THEN 1 ELSE 0 END)`,
  };
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

function predicateFor(hourKey: string): string {
  const parts = hourKeyParts(hourKey);
  return [
    `year = '${parts.year}'`,
    `month = '${parts.month}'`,
    `day = '${parts.day}'`,
    `hour = '${parts.hour}'`,
  ].join(" AND ");
}

/**
 * Builds ONE Athena statement that scans a single UTC hour and returns, in a
 * single pass, the grand-total aggregate row plus per-status, per-device, and
 * per-ip grouped rows via GROUPING SETS.
 *
 * The per-ip rows feed the country breakdown downstream; `topPaths` bounds how
 * many of them {@link assembleResult} keeps.
 */
export function buildHourlyQuery({
  table,
  hourKey,
  topPaths: _topPaths,
  extraPredicate,
}: {
  table: string;
  hourKey: string;
  topPaths: number;
  extraPredicate?: string;
}): string {
  const columns = columnMap;
  const predicate = predicateFor(hourKey);
  const device = deviceCaseExpression(columns.userAgent);
  const cacheCounts = cacheCountExpressions("rt");

  const whereClause =
    extraPredicate == null || extraPredicate === ""
      ? predicate
      : `${predicate} AND ${extraPredicate}`;

  // The inner subquery projects plain columns: the numeric casts and the device
  // classification are resolved here into simple aliases (st/scb/csb/tt/rt/ip/device).
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
    `    ${columns.clientIp} AS ip,`,
    `    ${device} AS device`,
    `  FROM "${table}"`,
    `  WHERE ${whereClause}`,
  ].join("\n");

  const groupingSets = ["()", "(st)", "(device)", "(ip)"].join(", ");

  return [
    "SELECT",
    "  st AS status_value,",
    "  device,",
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
    `  ${cacheCounts.hits} AS cache_hits,`,
    `  ${cacheCounts.misses} AS cache_misses,`,
    `  ${cacheCounts.errors} AS cache_errors,`,
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
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
  readonly uniqueIpCount: number;
}

export interface HourlyAthenaResult {
  readonly totals: HourlyAthenaTotals;
  readonly byStatus: Array<BreakdownRow>;
  readonly byDevice: Array<BreakdownRow>;
  readonly topIps: Array<{ ip: string; hits: number }>;
}

interface ResultRow {
  readonly status: string | undefined;
  readonly device: string | undefined;
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
  readonly cacheMisses: number;
  readonly cacheErrors: number;
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
    ip: cellValue(columns[2]),
    hits: toNumber(columns[3]),
    success: toNumber(columns[4]),
    errors: toNumber(columns[5]),
    errors4xx: toNumber(columns[6]),
    errors5xx: toNumber(columns[7]),
    bytesSent: toNumber(columns[8]),
    bytesReceived: toNumber(columns[9]),
    p50TimeTaken: toNumber(columns[10]),
    p95TimeTaken: toNumber(columns[11]),
    cacheHits: toNumber(columns[12]),
    cacheMisses: toNumber(columns[13]),
    cacheErrors: toNumber(columns[14]),
    uniqueIpCount: toNumber(columns[15]),
  };
}

function assembleResult({
  rows,
  topPaths,
}: {
  rows: Array<ResultRow>;
  topPaths: number;
}): HourlyAthenaResult {
  const totalsRow = rows.find((row) => row.status == null && row.device == null && row.ip == null);

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
          cacheHits: 0,
          cacheMisses: 0,
          cacheErrors: 0,
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
          cacheHits: totalsRow.cacheHits,
          cacheMisses: totalsRow.cacheMisses,
          cacheErrors: totalsRow.cacheErrors,
          uniqueIpCount: totalsRow.uniqueIpCount,
        };

  const byStatus: Array<BreakdownRow> = rows
    .filter((row) => row.status != null && row.device == null && row.ip == null)
    .map((row) => ({ value: row.status ?? "", hits: row.hits, bytes: row.bytesSent }));

  const byDevice: Array<BreakdownRow> = rows
    .filter((row) => row.device != null && row.status == null && row.ip == null)
    .map((row) => ({ value: row.device ?? "", hits: row.hits, bytes: row.bytesSent }));

  const topIps = rows
    .filter((row) => row.ip != null && row.status == null && row.device == null)
    .map((row) => ({ ip: row.ip ?? "", hits: row.hits }))
    .sort((left, right) => right.hits - left.hits)
    .slice(0, topPaths);

  return { totals, byStatus, byDevice, topIps };
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

async function fetchRawRows({
  athena,
  queryExecutionId,
}: {
  athena: Pick<AthenaClient, "send">;
  queryExecutionId: string;
}): Promise<Array<Array<string | undefined>>> {
  const rows: Array<Array<string | undefined>> = [];
  let nextToken: string | undefined;
  let isFirstPage = true;

  do {
    const results = await athena.send(
      new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId, NextToken: nextToken }),
    );

    const resultRows = results.ResultSet?.Rows ?? [];
    const dataRows = isFirstPage ? resultRows.slice(1) : resultRows;

    for (const dataRow of dataRows) {
      rows.push((dataRow.Data ?? []).map((datum) => datum.VarCharValue));
    }

    nextToken = results.NextToken;
    isFirstPage = false;
  } while (nextToken != null);

  return rows;
}

/**
 * Start an Athena statement, poll until it succeeds, and return every result
 * row as raw string cells (header row dropped). Shared by the hourly query and
 * the sitemap monthly query so both use one polling/paging implementation.
 */
export async function startAndFetchRows({
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
}): Promise<Array<Array<string | undefined>>> {
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
  return fetchRawRows({ athena, queryExecutionId });
}

export async function runHourlyAthenaQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  hourKey,
  topPaths,
  extraPredicate,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  hourKey: string;
  topPaths: number;
  extraPredicate?: string;
}): Promise<HourlyAthenaResult> {
  const queryString = buildHourlyQuery({ table, hourKey, topPaths, extraPredicate });

  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });
  const rows = rawRows.map((cells) => parseRow(cells));

  return assembleResult({ rows, topPaths });
}

/**
 * Build an Athena statement returning a single scalar `uniques` column: the
 * approximate distinct client-IP count over one UTC day's partitions.
 */
export function buildDayUniquesQuery({ table, dayKey }: { table: string; dayKey: string }): string {
  const parts = dayKeyParts(dayKey);
  const predicate = `year = '${parts.year}' AND month = '${parts.month}' AND day = '${parts.day}'`;
  return [
    "SELECT",
    `  approx_distinct(${columnMap.clientIp}) AS uniques`,
    `FROM "${table}"`,
    `WHERE ${predicate}`,
  ].join("\n");
}

/**
 * Build an Athena statement returning a single scalar `uniques` column: the
 * approximate distinct client-IP count over a whole `YYYY-MM`'s partitions.
 * Uniques are non-additive, so a month is rescanned fresh rather than summed
 * from its days.
 */
export function buildMonthUniquesQuery({
  table,
  monthKey,
}: {
  table: string;
  monthKey: string;
}): string {
  const parts = monthKeyParts(monthKey);
  const predicate = `year = '${parts.year}' AND month = '${parts.month}'`;
  return [
    "SELECT",
    `  approx_distinct(${columnMap.clientIp}) AS uniques`,
    `FROM "${table}"`,
    `WHERE ${predicate}`,
  ].join("\n");
}

/**
 * Build an Athena statement returning every distinct slash-collapsed URI served
 * in one UTC day. Feeds the URL directory's daily `firstSeen` upsert. The result
 * set is one row per distinct URL and can be large on a high-cardinality site.
 */
export function buildDayUrlsQuery({ table, dayKey }: { table: string; dayKey: string }): string {
  const parts = dayKeyParts(dayKey);
  const canonicalUri = canonicalUriExpr(columnMap.uriStem);
  const predicate = `year = '${parts.year}' AND month = '${parts.month}' AND day = '${parts.day}'`;
  return [
    "SELECT DISTINCT",
    `  ${canonicalUri} AS url`,
    `FROM "${table}"`,
    `WHERE ${predicate}`,
  ].join("\n");
}

export async function runDayUniques({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  dayKey,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  dayKey: string;
}): Promise<number> {
  const queryString = buildDayUniquesQuery({ table, dayKey });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });
  return toCount(rawRows[0]?.[0]);
}

export async function runMonthUniques({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  monthKey,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  monthKey: string;
}): Promise<number> {
  const queryString = buildMonthUniquesQuery({ table, monthKey });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });
  return toCount(rawRows[0]?.[0]);
}

export async function runDayUrls({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  dayKey,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  dayKey: string;
}): Promise<Array<string>> {
  const queryString = buildDayUrlsQuery({ table, dayKey });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });

  const urls: Array<string> = [];
  for (const cells of rawRows) {
    const url = cells[0];
    if (url == null || url === "") continue;
    urls.push(url);
  }
  return urls;
}
