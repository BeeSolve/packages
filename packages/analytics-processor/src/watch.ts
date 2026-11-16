import type { AthenaClient } from "@aws-sdk/client-athena";
import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import { splitArrayToChunks } from "@beesolve/helpers";
import * as v from "valibot";

import type { AppliedMarkers } from "./appliedMarkers.ts";
import { cacheCountExpressions, columnMap, hourKeyParts, startAndFetchRows } from "./athena.ts";
import type { TransactItem } from "./processHour.ts";
import { sendTransacted } from "./processHour.ts";
import { canonicalUriExpr, escapeSqlString, toCount } from "./sql.ts";

type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type UpdateMembers = NonNullable<TransactWriteItem["Update"]>;

export const watchModes = ["exact", "split", "group"] as const;
export type WatchMode = (typeof watchModes)[number];

export const watchSources = ["sitemap", "manual"] as const;
export type WatchSource = (typeof watchSources)[number];

export const watchStatuses = ["active", "stopped"] as const;
export type WatchStatus = (typeof watchStatuses)[number];

export interface WatchEntry {
  readonly matcher: string;
  readonly mode: WatchMode;
  readonly source: WatchSource;
  readonly status: WatchStatus;
  readonly label?: string;
  readonly firstSeen: string;
}

export const watchEntrySchema = v.looseObject({
  matcher: v.string(),
  mode: v.picklist(watchModes),
  source: v.picklist(watchSources),
  status: v.picklist(watchStatuses),
  label: v.optional(v.string()),
  firstSeen: v.string(),
});
export type WatchEntryRecord = v.InferOutput<typeof watchEntrySchema>;

/**
 * Key scheme for a watch config row. Config rows live at
 * `pk = "watch#<matcher>", sk = "config"` and are listable via the reverse
 * index by querying `sk = "config"` with `begins_with(pk, "watch#")`.
 */
export function watchConfigKey({ matcher }: { readonly matcher: string }): {
  readonly pk: string;
  readonly sk: string;
} {
  return { pk: partitionKey(matcher), sk: "config" };
}

export const watchPkPrefix = "watch#";
export const watchConfigSk = "config";

export function partitionKey(matcher: string): string {
  return `${watchPkPrefix}${matcher}`;
}

/**
 * Partition key for a watch bucket's metric records. `exact`/`group` modes map
 * to a single bucket `watch#<matcher>`; `split` mode fans out to one bucket per
 * path under the prefix, `watch#<prefix>#<path>`. Built on {@link partitionKey}
 * so the config pk scheme and the stats pk scheme stay aligned.
 */
export function watchStatsPk({
  matcher,
  mode,
  path,
}: {
  readonly matcher: string;
  readonly mode: WatchMode;
  readonly path?: string;
}): string {
  if (mode === "split") {
    if (path == null) {
      throw new Error("watchStatsPk requires a path for split mode");
    }
    return `${partitionKey(matcher)}#${path}`;
  }
  return partitionKey(matcher);
}

export interface WatchMonthCounts {
  readonly matcher: string;
  readonly mode: WatchMode;
  readonly path?: string;
  readonly month: string;
  readonly days: Record<string, number>;
  readonly hits: number;
  readonly bytesSent: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
  readonly bytesSaved: number;
  readonly errors: number;
  readonly redirects: number;
}

export const watchStatsSchema = v.looseObject({
  pk: v.string(),
  sk: v.string(),
  matcher: v.string(),
  mode: v.picklist(watchModes),
  month: v.string(),
  hits: v.number(),
  bytesSent: v.number(),
  cacheHits: v.number(),
  cacheMisses: v.number(),
  cacheErrors: v.number(),
  bytesSaved: v.number(),
  errors: v.number(),
  redirects: v.number(),
  updatedAt: v.number(),
});
export type WatchStat = v.InferOutput<typeof watchStatsSchema>;

export interface WatchStatsRecord {
  readonly pk: string;
  readonly sk: string;
  readonly matcher: string;
  readonly mode: WatchMode;
  readonly month: string;
  readonly hits: number;
  readonly bytesSent: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
  readonly bytesSaved: number;
  readonly errors: number;
  readonly redirects: number;
  readonly updatedAt: number;
  readonly days: Record<string, number>;
}

const watchScalarMetrics = [
  "bytesSent",
  "cacheHits",
  "cacheMisses",
  "cacheErrors",
  "bytesSaved",
  "errors",
  "redirects",
] as const;
type WatchScalarMetric = (typeof watchScalarMetrics)[number];

export class WatchStats {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  readonly buildAdd = ({
    matcher,
    mode,
    path,
    month,
    dayAttr,
    hits,
    bytesSent,
    cacheHits,
    cacheMisses,
    cacheErrors,
    bytesSaved,
    errors,
    redirects,
  }: {
    readonly matcher: string;
    readonly mode: WatchMode;
    readonly path?: string;
    readonly month: string;
    readonly dayAttr: string;
    readonly hits: number;
    readonly bytesSent: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
    readonly cacheErrors: number;
    readonly bytesSaved: number;
    readonly errors: number;
    readonly redirects: number;
  }): TransactItem => {
    const scalarValues: Record<WatchScalarMetric, number> = {
      bytesSent,
      cacheHits,
      cacheMisses,
      cacheErrors,
      bytesSaved,
      errors,
      redirects,
    };

    const names: Record<string, string> = {
      "#matcher": "matcher",
      "#mode": "mode",
      "#month": "month",
      "#updatedAt": "updatedAt",
      "#hits": "hits",
      "#day": dayAttr,
    };
    const valuesMap: Record<string, unknown> = {
      ":matcher": matcher,
      ":mode": mode,
      ":month": month,
      ":now": Date.now(),
      ":hits": hits,
    };
    const addParts = ["#hits :hits", "#day :hits"];

    for (const metric of watchScalarMetrics) {
      names[`#${metric}`] = metric;
      valuesMap[`:${metric}`] = scalarValues[metric];
      addParts.push(`#${metric} :${metric}`);
    }

    const update: UpdateMembers = {
      TableName: this.props.tableName,
      Key: { pk: watchStatsPk({ matcher, mode, path }), sk: month },
      UpdateExpression: `SET #matcher = :matcher, #mode = :mode, #month = :month, #updatedAt = :now ADD ${addParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: valuesMap,
    };
    return { Update: update };
  };

  readonly overwriteMany = async (stats: Array<WatchMonthCounts>): Promise<void> => {
    for (const stat of stats) {
      await this.props.dynamo.send(new UpdateCommand(this.buildOverwrite(stat)));
    }
  };

  readonly buildOverwrite = ({
    matcher,
    mode,
    path,
    month,
    days,
    hits,
    bytesSent,
    cacheHits,
    cacheMisses,
    cacheErrors,
    bytesSaved,
    errors,
    redirects,
  }: {
    readonly matcher: string;
    readonly mode: WatchMode;
    readonly path?: string;
    readonly month: string;
    readonly days: Record<string, number>;
    readonly hits: number;
    readonly bytesSent: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
    readonly cacheErrors: number;
    readonly bytesSaved: number;
    readonly errors: number;
    readonly redirects: number;
  }): UpdateMembers => {
    const scalarValues: Record<WatchScalarMetric, number> = {
      bytesSent,
      cacheHits,
      cacheMisses,
      cacheErrors,
      bytesSaved,
      errors,
      redirects,
    };

    const names: Record<string, string> = {
      "#matcher": "matcher",
      "#mode": "mode",
      "#month": "month",
      "#hits": "hits",
      "#updatedAt": "updatedAt",
    };
    const valuesMap: Record<string, unknown> = {
      ":matcher": matcher,
      ":mode": mode,
      ":month": month,
      ":hits": hits,
      ":now": Date.now(),
    };
    const setParts = [
      "#matcher = :matcher",
      "#mode = :mode",
      "#month = :month",
      "#hits = :hits",
      "#updatedAt = :now",
    ];

    for (const metric of watchScalarMetrics) {
      names[`#${metric}`] = metric;
      valuesMap[`:${metric}`] = scalarValues[metric];
      setParts.push(`#${metric} = :${metric}`);
    }

    for (const [dayKey, count] of Object.entries(days)) {
      const dayAttr = `d${dayKey}`;
      names[`#${dayAttr}`] = dayAttr;
      valuesMap[`:${dayAttr}`] = count;
      setParts.push(`#${dayAttr} = :${dayAttr}`);
    }

    return {
      TableName: this.props.tableName,
      Key: { pk: watchStatsPk({ matcher, mode, path }), sk: month },
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: valuesMap,
    };
  };

  readonly getForEntry = async ({
    matcher,
    mode,
    path,
    startMonth,
    endMonth,
  }: {
    readonly matcher: string;
    readonly mode: WatchMode;
    readonly path?: string;
    readonly startMonth: string;
    readonly endMonth: string;
  }): Promise<Array<WatchStatsRecord>> => {
    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: {
          ":pk": watchStatsPk({ matcher, mode, path }),
          ":start": startMonth,
          ":end": endMonth,
        },
      },
    });

    return items.map((item) => this.parseOne(item));
  };

  readonly getForMonth = async ({
    month,
  }: {
    readonly month: string;
  }): Promise<Array<WatchStatsRecord>> => {
    if (this.props.reverseIndexName == null) {
      throw new Error("getForMonth requires a reverseIndexName");
    }

    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :month AND begins_with(#pk, :pkPrefix)",
        ExpressionAttributeNames: { "#sk": "sk", "#pk": "pk" },
        ExpressionAttributeValues: { ":month": month, ":pkPrefix": watchPkPrefix },
      },
    });

    return items.map((item) => this.parseOne(item));
  };

  private readonly parseOne = (item: unknown): WatchStatsRecord => {
    const result = v.safeParse(watchStatsSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored watch stat record");
    }

    const days: Record<string, number> = {};
    for (const [key, value] of Object.entries(result.output)) {
      const dayMatch = /^d(\d{2})$/.exec(key);
      if (dayMatch?.[1] != null && typeof value === "number") {
        days[dayMatch[1]] = value;
      }
    }

    return {
      pk: result.output.pk,
      sk: result.output.sk,
      matcher: result.output.matcher,
      mode: result.output.mode,
      month: result.output.month,
      hits: result.output.hits,
      bytesSent: result.output.bytesSent,
      cacheHits: result.output.cacheHits,
      cacheMisses: result.output.cacheMisses,
      cacheErrors: result.output.cacheErrors,
      bytesSaved: result.output.bytesSaved,
      errors: result.output.errors,
      redirects: result.output.redirects,
      updatedAt: result.output.updatedAt,
      days,
    };
  };
}

export interface WatchMatcher {
  readonly matcher: string;
  readonly mode: WatchMode;
}

function watchWherePredicate({ matcher, mode }: WatchMatcher): string {
  const canonicalUri = canonicalUriExpr(columnMap.uriStem);
  if (mode === "exact") {
    return `${canonicalUri} = '${escapeSqlString(matcher)}'`;
  }
  return `${columnMap.uriStem} LIKE '${escapeSqlString(matcher)}%'`;
}

function watchMetricColumns(): Array<string> {
  const cacheCounts = cacheCountExpressions(columnMap.resultType);
  const bytesSaved = `sum(CASE WHEN ${columnMap.resultType} IN ('Hit','RefreshHit') THEN ${columnMap.bytesSent} ELSE 0 END)`;
  const errors = `sum(CASE WHEN ${columnMap.status} BETWEEN 400 AND 599 THEN 1 ELSE 0 END)`;
  const redirects = `sum(CASE WHEN ${columnMap.status} BETWEEN 300 AND 399 THEN 1 ELSE 0 END)`;
  return [
    "count(*) AS hits",
    `sum(${columnMap.bytesSent}) AS bytes_sent`,
    `${cacheCounts.hits} AS cache_hits`,
    `${cacheCounts.misses} AS cache_misses`,
    `${cacheCounts.errors} AS cache_errors`,
    `${bytesSaved} AS bytes_saved`,
    `${errors} AS errors`,
    `${redirects} AS redirects`,
  ];
}

export interface WatchHourCounts {
  readonly path?: string;
  readonly hits: number;
  readonly bytesSent: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
  readonly bytesSaved: number;
  readonly errors: number;
  readonly redirects: number;
}

/**
 * Build an Athena statement that aggregates a single UTC hour's watch metrics
 * for one watch entry. `exact` matches the slash-collapsed URI equal to the
 * matcher; `group` and `split` match `cs_uri_stem LIKE '<prefix>%'`. `split`
 * adds `GROUP BY <canonicalUri>` and emits a leading `path_value` column so each
 * path under the prefix becomes its own row; `exact`/`group` collapse to one
 * aggregate row. Reuses {@link ../src/athena.ts cacheCountExpressions} and the
 * shared {@link ../src/sql.ts canonicalUriExpr}/{@link ../src/sql.ts escapeSqlString}.
 */
export function buildWatchHourlyQuery({
  table,
  hourKey,
  matcher,
  mode,
}: {
  table: string;
  hourKey: string;
  matcher: string;
  mode: WatchMode;
}): string {
  const parts = hourKeyParts(hourKey);
  const hourPredicate = `year = '${parts.year}' AND month = '${parts.month}' AND day = '${parts.day}' AND hour = '${parts.hour}'`;
  const whereClause = `${hourPredicate} AND ${watchWherePredicate({ matcher, mode })}`;
  return assembleWatchQuery({ table, whereClause, mode, byDay: false });
}

/**
 * Run {@link buildWatchHourlyQuery} and return the aggregated metrics for the
 * hour. `exact`/`group` yield a single pathless bucket; `split` yields one
 * bucket per path (the slash-collapsed URI). A zero-row result returns `[]`.
 */
export async function runWatchHourlyQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  hourKey,
  matcher,
  mode,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  hourKey: string;
  matcher: string;
  mode: WatchMode;
}): Promise<Array<WatchHourCounts>> {
  const queryString = buildWatchHourlyQuery({ table, hourKey, matcher, mode });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });

  const counts: Array<WatchHourCounts> = [];
  for (const cells of rawRows) {
    const row = parseWatchRow({ cells, mode, byDay: false });
    if (row == null) continue;
    counts.push(row.counts);
  }
  return counts;
}

/**
 * Build an Athena statement that aggregates a whole `YYYY-MM`'s watch metrics
 * for one watch entry, grouped by day-of-month (and by the slash-collapsed URI
 * for `split`). One scan of the month's partitions replaces 720 single-hour
 * scans, which is why backfill uses this instead of
 * {@link buildWatchHourlyQuery}. Emits a leading `day_value` column mirroring
 * {@link ../src/sitemap.ts buildSitemapMonthlyQuery}.
 */
export function buildWatchMonthlyQuery({
  table,
  monthKey,
  matcher,
  mode,
}: {
  table: string;
  monthKey: string;
  matcher: string;
  mode: WatchMode;
}): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (match == null) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }
  const [, year, month] = match;
  if (year == null || month == null) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }
  const monthPredicate = `year = '${year}' AND month = '${month}'`;
  const whereClause = `${monthPredicate} AND ${watchWherePredicate({ matcher, mode })}`;
  return assembleWatchQuery({ table, whereClause, mode, byDay: true });
}

/**
 * Run {@link buildWatchMonthlyQuery} and reshape the rows into one
 * {@link WatchMonthCounts} per bucket, with day-of-month zero-padded to `dd`.
 * `exact`/`group` yield a single pathless bucket; `split` yields one bucket per
 * path. A zero-row result returns `[]`.
 */
export async function runWatchMonthlyQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  monthKey,
  matcher,
  mode,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  monthKey: string;
  matcher: string;
  mode: WatchMode;
}): Promise<Array<WatchMonthCounts>> {
  const queryString = buildWatchMonthlyQuery({ table, monthKey, matcher, mode });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });

  const byBucket: Record<
    string,
    {
      path?: string;
      days: Record<string, number>;
      hits: number;
      bytesSent: number;
      cacheHits: number;
      cacheMisses: number;
      cacheErrors: number;
      bytesSaved: number;
      errors: number;
      redirects: number;
    }
  > = {};

  for (const cells of rawRows) {
    const row = parseWatchRow({ cells, mode, byDay: true });
    if (row == null || row.day == null) continue;

    const bucketKey = row.counts.path ?? "__single__";
    const existing = byBucket[bucketKey] ?? {
      path: row.counts.path,
      days: {},
      hits: 0,
      bytesSent: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheErrors: 0,
      bytesSaved: 0,
      errors: 0,
      redirects: 0,
    };
    const dayKey = String(row.day).padStart(2, "0");
    existing.days[dayKey] = (existing.days[dayKey] ?? 0) + row.counts.hits;
    existing.hits += row.counts.hits;
    existing.bytesSent += row.counts.bytesSent;
    existing.cacheHits += row.counts.cacheHits;
    existing.cacheMisses += row.counts.cacheMisses;
    existing.cacheErrors += row.counts.cacheErrors;
    existing.bytesSaved += row.counts.bytesSaved;
    existing.errors += row.counts.errors;
    existing.redirects += row.counts.redirects;
    byBucket[bucketKey] = existing;
  }

  return Object.values(byBucket).map((entry) => ({
    matcher,
    mode,
    path: entry.path,
    month: monthKey,
    days: entry.days,
    hits: entry.hits,
    bytesSent: entry.bytesSent,
    cacheHits: entry.cacheHits,
    cacheMisses: entry.cacheMisses,
    cacheErrors: entry.cacheErrors,
    bytesSaved: entry.bytesSaved,
    errors: entry.errors,
    redirects: entry.redirects,
  }));
}

function assembleWatchQuery({
  table,
  whereClause,
  mode,
  byDay,
}: {
  table: string;
  whereClause: string;
  mode: WatchMode;
  byDay: boolean;
}): string {
  const canonicalUri = canonicalUriExpr(columnMap.uriStem);
  const leadingColumns: Array<string> = [];
  const groupBy: Array<string> = [];

  if (byDay) {
    leadingColumns.push("day AS day_value");
    groupBy.push("day");
  }
  if (mode === "split") {
    leadingColumns.push(`${canonicalUri} AS path_value`);
    groupBy.push(canonicalUri);
  }

  const selectColumns = [...leadingColumns, ...watchMetricColumns()];

  const lines = [
    "SELECT",
    selectColumns.map((column) => `  ${column}`).join(",\n"),
    `FROM "${table}"`,
    `WHERE ${whereClause}`,
  ];
  if (groupBy.length > 0) {
    lines.push(`GROUP BY ${groupBy.join(", ")}`);
  }
  return lines.join("\n");
}

interface ParsedWatchRow {
  readonly day?: string;
  readonly counts: WatchHourCounts;
}

function parseWatchRow({
  cells,
  mode,
  byDay,
}: {
  cells: Array<string | undefined>;
  mode: WatchMode;
  byDay: boolean;
}): ParsedWatchRow | undefined {
  let index = 0;
  const day = byDay ? cells[index++] : undefined;
  const path = mode === "split" ? cells[index++] : undefined;

  if (byDay && (day == null || day === "")) return undefined;
  if (mode === "split" && (path == null || path === "")) return undefined;

  const counts: WatchHourCounts = {
    path: mode === "split" ? path : undefined,
    hits: toCount(cells[index++]),
    bytesSent: toCount(cells[index++]),
    cacheHits: toCount(cells[index++]),
    cacheMisses: toCount(cells[index++]),
    cacheErrors: toCount(cells[index++]),
    bytesSaved: toCount(cells[index++]),
    errors: toCount(cells[index++]),
    redirects: toCount(cells[index++]),
  };

  return { day, counts };
}

export interface ProcessWatchAthena {
  readonly client: Pick<AthenaClient, "send">;
  readonly database: string;
  readonly table: string;
  readonly workgroup: string;
  readonly outputLocation?: string;
}

export interface ProcessWatchHourModels {
  readonly watchStats: Pick<WatchStats, "buildAdd">;
  readonly markers: Pick<AppliedMarkers, "isApplied" | "buildMarkerPut">;
}

export interface ProcessWatchOptions {
  readonly markerTtlDays?: number;
}

/**
 * Incrementally add a single UTC hour's watch metrics to the entry's
 * `(bucket, month)` items, guarded by a per-entry per-hour applied-marker so
 * distinct watch entries never share a marker and each hour is counted at most
 * once. The marker's `periodKey` is `"<matcher>#<hourKey>"`. Returns
 * `{ status: "skipped", buckets: 0 }` when the hour is already applied and
 * `{ status: "applied", buckets }` otherwise (`buckets: 0` when nothing matched).
 */
export async function processWatchHour({
  hourKey,
  entry,
  models,
  athena,
  options,
  dynamo,
}: {
  hourKey: string;
  entry: WatchMatcher;
  models: ProcessWatchHourModels;
  athena: ProcessWatchAthena;
  options?: ProcessWatchOptions;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<{ status: "applied" | "skipped"; buckets: number }> {
  const periodKey = watchMarkerPeriodKey({ matcher: entry.matcher, hourKey });
  const alreadyApplied = await models.markers.isApplied({ grain: "watch", periodKey });
  if (alreadyApplied) return { status: "skipped", buckets: 0 };

  const counts = await runWatchHourlyQuery({
    athena: athena.client,
    database: athena.database,
    table: athena.table,
    workgroup: athena.workgroup,
    outputLocation: athena.outputLocation,
    hourKey,
    matcher: entry.matcher,
    mode: entry.mode,
  });

  return writeWatchHour({ hourKey, entry, counts, models, options, dynamo });
}

export interface WatchHourBatchResult {
  readonly matcher: string;
  readonly status: "applied" | "skipped" | "failed";
  readonly buckets: number;
  readonly error?: unknown;
}

/**
 * Process one UTC hour for many watch entries with a single Athena query per
 * {@link watchBatchSize} entries, instead of one query per entry. Athena bills a
 * 10 MB minimum per query and the hourly partitions are tiny, so the per-entry
 * queries were billed almost entirely on that floor. The batch query selects the
 * union of all pending entries' rows, grouped by raw `cs_uri_stem`; each entry's
 * buckets are then assembled in memory. Markers, `ADD` semantics and per-entry
 * transactions are the same as {@link processWatchHour}. A write failure for one
 * entry is reported as `failed` and does not stop the others.
 */
export async function processWatchHourBatch({
  hourKey,
  entries,
  models,
  athena,
  options,
  dynamo,
}: {
  hourKey: string;
  entries: ReadonlyArray<WatchMatcher>;
  models: ProcessWatchHourModels;
  athena: ProcessWatchAthena;
  options?: ProcessWatchOptions;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<Array<WatchHourBatchResult>> {
  const applied = await Promise.all(
    entries.map((entry) =>
      models.markers.isApplied({
        grain: "watch",
        periodKey: watchMarkerPeriodKey({ matcher: entry.matcher, hourKey }),
      }),
    ),
  );

  const results: Array<WatchHourBatchResult> = [];
  const pending: Array<WatchMatcher> = [];
  entries.forEach((entry, index) => {
    if (applied[index] === true) {
      results.push({ matcher: entry.matcher, status: "skipped", buckets: 0 });
      return;
    }
    pending.push(entry);
  });

  for (const chunk of splitArrayToChunks(pending, watchBatchSize)) {
    const rows = await runWatchHourBatchQuery({
      athena: athena.client,
      database: athena.database,
      table: athena.table,
      workgroup: athena.workgroup,
      outputLocation: athena.outputLocation,
      hourKey,
      entries: chunk,
    });

    for (const entry of chunk) {
      const counts = assembleWatchEntryCounts({ entry, rows });
      try {
        const written = await writeWatchHour({ hourKey, entry, counts, models, options, dynamo });
        results.push({ matcher: entry.matcher, ...written });
      } catch (error) {
        results.push({ matcher: entry.matcher, status: "failed", buckets: 0, error });
      }
    }
  }

  return results;
}

/**
 * Build the single Athena statement behind {@link processWatchHourBatch}: one
 * UTC hour, filtered to the union of every entry's predicate (`exact` entries as
 * one `IN` list on the slash-collapsed URI, `group`/`split` entries as `LIKE
 * '<prefix>%'`), grouped by raw `cs_uri_stem`. Leading `path_value` column holds
 * the raw URI, followed by the same metric columns as the per-entry query.
 */
export function buildWatchHourBatchQuery({
  table,
  hourKey,
  entries,
}: {
  table: string;
  hourKey: string;
  entries: ReadonlyArray<WatchMatcher>;
}): string {
  if (entries.length === 0) throw new Error("buildWatchHourBatchQuery requires at least one entry");

  const parts = hourKeyParts(hourKey);
  const hourPredicate = `year = '${parts.year}' AND month = '${parts.month}' AND day = '${parts.day}' AND hour = '${parts.hour}'`;

  const exactMatchers = entries.filter((entry) => entry.mode === "exact");
  const prefixMatchers = entries.filter((entry) => entry.mode !== "exact");
  const alternatives: Array<string> = [];
  if (exactMatchers.length > 0) {
    const list = exactMatchers.map((entry) => `'${escapeSqlString(entry.matcher)}'`).join(", ");
    alternatives.push(`${canonicalUriExpr(columnMap.uriStem)} IN (${list})`);
  }
  for (const entry of prefixMatchers) {
    alternatives.push(`${columnMap.uriStem} LIKE '${escapeSqlString(entry.matcher)}%'`);
  }

  return [
    "SELECT",
    [`  ${columnMap.uriStem} AS path_value`, ...watchMetricColumns().map((c) => `  ${c}`)].join(
      ",\n",
    ),
    `FROM "${table}"`,
    `WHERE ${hourPredicate} AND (${alternatives.join(" OR ")})`,
    `GROUP BY ${columnMap.uriStem}`,
  ].join("\n");
}

async function runWatchHourBatchQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  hourKey,
  entries,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  hourKey: string;
  entries: ReadonlyArray<WatchMatcher>;
}): Promise<Array<WatchHourCounts>> {
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString: buildWatchHourBatchQuery({ table, hourKey, entries }),
  });

  const rows: Array<WatchHourCounts> = [];
  for (const cells of rawRows) {
    const row = parseWatchRow({ cells, mode: "split", byDay: false });
    if (row == null) continue;
    rows.push(row.counts);
  }
  return rows;
}

function canonicalUri(uri: string): string {
  return uri.length > 1 && uri.endsWith("/") ? uri.slice(0, -1) : uri;
}

const zeroCounts: Omit<WatchHourCounts, "path"> = {
  hits: 0,
  bytesSent: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheErrors: 0,
  bytesSaved: 0,
  errors: 0,
  redirects: 0,
};

function addCounts(
  target: Omit<WatchHourCounts, "path">,
  row: WatchHourCounts,
): Omit<WatchHourCounts, "path"> {
  return {
    hits: target.hits + row.hits,
    bytesSent: target.bytesSent + row.bytesSent,
    cacheHits: target.cacheHits + row.cacheHits,
    cacheMisses: target.cacheMisses + row.cacheMisses,
    cacheErrors: target.cacheErrors + row.cacheErrors,
    bytesSaved: target.bytesSaved + row.bytesSaved,
    errors: target.errors + row.errors,
    redirects: target.redirects + row.redirects,
  };
}

/**
 * Reproduce, in memory, what the per-entry query returned: `exact` and `group`
 * collapse to exactly one pathless bucket (zeros when nothing matched, as SQL
 * aggregation without `GROUP BY` does); `split` yields one bucket per
 * slash-collapsed path under the prefix.
 */
function assembleWatchEntryCounts({
  entry,
  rows,
}: {
  entry: WatchMatcher;
  rows: ReadonlyArray<WatchHourCounts>;
}): Array<WatchHourCounts> {
  if (entry.mode === "split") {
    const byPath: Record<string, Omit<WatchHourCounts, "path">> = {};
    for (const row of rows) {
      if (row.path == null || !row.path.startsWith(entry.matcher)) continue;
      const path = canonicalUri(row.path);
      byPath[path] = addCounts(byPath[path] ?? zeroCounts, row);
    }
    return Object.entries(byPath).map(([path, counts]) => ({ path, ...counts }));
  }

  let total = zeroCounts;
  for (const row of rows) {
    if (row.path == null) continue;
    const matches =
      entry.mode === "exact"
        ? canonicalUri(row.path) === entry.matcher
        : row.path.startsWith(entry.matcher);
    if (matches) total = addCounts(total, row);
  }
  return [{ ...total }];
}

async function writeWatchHour({
  hourKey,
  entry,
  counts,
  models,
  options,
  dynamo,
}: {
  hourKey: string;
  entry: WatchMatcher;
  counts: ReadonlyArray<WatchHourCounts>;
  models: ProcessWatchHourModels;
  options?: ProcessWatchOptions;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<{ status: "applied" | "skipped"; buckets: number }> {
  const periodKey = watchMarkerPeriodKey({ matcher: entry.matcher, hourKey });
  const parts = hourKeyParts(hourKey);
  const monthKey = `${parts.year}-${parts.month}`;
  const dayAttr = `d${parts.day}`;

  const ttl = computeWatchMarkerTtl(options?.markerTtlDays);
  const markerPut = models.markers.buildMarkerPut({ grain: "watch", periodKey, ttl });

  const addUpdates = counts.map((count) =>
    models.watchStats.buildAdd({
      matcher: entry.matcher,
      mode: entry.mode,
      path: count.path,
      month: monthKey,
      dayAttr,
      hits: count.hits,
      bytesSent: count.bytesSent,
      cacheHits: count.cacheHits,
      cacheMisses: count.cacheMisses,
      cacheErrors: count.cacheErrors,
      bytesSaved: count.bytesSaved,
      errors: count.errors,
      redirects: count.redirects,
    }),
  );

  const result = await sendTransacted({ dynamo, leading: [markerPut], rest: addUpdates });
  return { status: result.status, buckets: result.status === "applied" ? counts.length : 0 };
}

export interface ProcessWatchMonthModels {
  readonly watchStats: Pick<WatchStats, "overwriteMany">;
}

/**
 * Recompute a whole month's watch metrics for one entry in a single Athena scan
 * and overwrite each `(bucket, month)` item with `SET`. This is the backfill
 * path: `SET` is idempotent so reruns are safe and no applied-marker is needed.
 * The live hourly cron uses {@link processWatchHour} (incremental `ADD`) instead.
 */
export async function processWatchMonth({
  monthKey,
  entry,
  models,
  athena,
}: {
  monthKey: string;
  entry: WatchMatcher;
  models: ProcessWatchMonthModels;
  athena: ProcessWatchAthena;
}): Promise<{ buckets: number }> {
  const counts = await runWatchMonthlyQuery({
    athena: athena.client,
    database: athena.database,
    table: athena.table,
    workgroup: athena.workgroup,
    outputLocation: athena.outputLocation,
    monthKey,
    matcher: entry.matcher,
    mode: entry.mode,
  });

  await models.watchStats.overwriteMany(counts);

  return { buckets: counts.length };
}

/**
 * The applied-marker `periodKey` for a watch entry's hour: a composite of the
 * matcher and the hour so distinct watch entries processed in the same hour get
 * independent markers and never collide.
 */
export function watchMarkerPeriodKey({
  matcher,
  hourKey,
}: {
  readonly matcher: string;
  readonly hourKey: string;
}): string {
  return `${matcher}#${hourKey}`;
}

const defaultWatchMarkerTtlDays = 90;
const watchBatchSize = 200;

function computeWatchMarkerTtl(markerTtlDays?: number): number {
  const days = markerTtlDays ?? defaultWatchMarkerTtlDays;
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}
