import type { AthenaClient } from "@aws-sdk/client-athena";
import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import * as v from "valibot";

import type { AppliedMarkers } from "./appliedMarkers.ts";
import { columnMaps, startAndFetchRows } from "./athena.ts";
import type { AppliedSource } from "./keys.ts";
import type { TransactItem } from "./processHour.ts";
import { sendTransacted } from "./processHour.ts";

type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type UpdateMembers = NonNullable<TransactWriteItem["Update"]>;

/**
 * Collapse a single trailing slash on a path so `/blog/` and `/blog` fold
 * together. Root `/` is preserved. Already-unslashed paths are returned as-is.
 */
export function canonicalPath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Parse an absolute sitemap `<loc>` URL and reduce it to a canonical path:
 * origin, query and fragment are stripped and a trailing slash is collapsed.
 * Throws on input the `URL` class cannot parse.
 */
export function normalizeSitemapLoc(loc: string): string {
  let parsed: URL;
  try {
    parsed = new URL(loc);
  } catch {
    throw new Error(`Unparseable sitemap <loc>: ${loc}`);
  }
  return canonicalPath(parsed.pathname);
}

/**
 * Extract every `<loc>` from a flat `<urlset>` sitemap, XML-unescape and
 * normalize each to a path, and dedupe preserving first-seen order (so a
 * `/blog` and `/blog/` pair collapse to one entry). Throws on a
 * `<sitemapindex>` document, which is not supported.
 */
export function parseSitemap(xml: string): Array<string> {
  if (sitemapIndexPattern.test(xml)) {
    throw new Error("Sitemap index documents are not supported");
  }

  const paths: Array<string> = [];
  const seen = new Set<string>();

  for (const match of xml.matchAll(locPattern)) {
    const raw = match[1];
    if (raw == null) continue;
    const loc = unescapeXml(raw.trim());
    if (loc === "") continue;
    const path = normalizeSitemapLoc(loc);
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

/**
 * Identifies this crawler's outbound sitemap requests so site operators can
 * distinguish them in their access logs.
 */
export const sitemapUserAgent =
  "@beesolve/analytics-processor sitemap fetcher (+https://github.com/BeeSolve/packages)";

/**
 * Fetch a sitemap over HTTP and return its normalized, deduped paths. Throws
 * with the response status if the request is not successful.
 */
export async function fetchSitemapPaths(url: string): Promise<Array<string>> {
  const res = await fetch(url, { headers: { "user-agent": sitemapUserAgent } });
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseSitemap(text);
}

export interface SitemapHourCounts {
  readonly path: string;
  readonly hits: number;
}

interface HourParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly monthKey: string;
  readonly dayAttr: string;
}

function hourKeyParts(hourKey: string): HourParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(hourKey);
  if (match == null) {
    throw new Error(`Invalid hourKey: ${hourKey}`);
  }
  const [, year, month, day, hour] = match;
  if (year == null || month == null || day == null || hour == null) {
    throw new Error(`Invalid hourKey: ${hourKey}`);
  }
  return { year, month, day, hour, monthKey: `${year}-${month}`, dayAttr: `d${day}` };
}

/**
 * Build an Athena statement that counts hits per `path` for a single UTC hour,
 * restricted to the given sitemap paths. The log-side URI is slash-collapsed in
 * SQL via {@link canonicalUriExpr} in both the `WHERE ... IN` and the
 * `GROUP BY`, mirroring {@link canonicalPath}, so `/blog` and the 301 hit on
 * `/blog/` both count against `/blog`. An empty `paths` yields a valid zero-row
 * statement (`WHERE 1 = 0`).
 */
export function buildSitemapHourlyQuery({
  table,
  source,
  hourKey,
  paths,
}: {
  table: string;
  source: AppliedSource;
  hourKey: string;
  paths: Array<string>;
}): string {
  const parts = hourKeyParts(hourKey);
  const columns = columnMaps[source];
  const canonicalUri = canonicalUriExpr(columns.uriStem);
  const hourPredicate =
    source === "v2"
      ? `year = '${parts.year}' AND month = '${parts.month}' AND day = '${parts.day}' AND hour = '${parts.hour}'`
      : `"date" = DATE '${parts.year}-${parts.month}-${parts.day}' AND substr(${columns.timestamp}, 1, 2) = '${parts.hour}'`;

  const whereClause =
    paths.length === 0
      ? "1 = 0"
      : `${hourPredicate} AND ${canonicalUri} IN (${paths.map((path) => `'${escapeSqlString(path)}'`).join(", ")})`;

  return [
    "SELECT",
    `  ${canonicalUri} AS path_value,`,
    "  count(*) AS hits",
    `FROM "${table}"`,
    `WHERE ${whereClause}`,
    `GROUP BY ${canonicalUri}`,
  ].join("\n");
}

/**
 * Run {@link buildSitemapHourlyQuery} and return one {@link SitemapHourCounts}
 * per path with hits for that hour. Short-circuits to `[]` without calling
 * Athena when `paths` is empty.
 */
export async function runSitemapHourlyQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  source,
  hourKey,
  paths,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  source: AppliedSource;
  hourKey: string;
  paths: Array<string>;
}): Promise<Array<SitemapHourCounts>> {
  if (paths.length === 0) {
    return [];
  }

  const queryString = buildSitemapHourlyQuery({ table, source, hourKey, paths });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });

  const byPath: Record<string, number> = {};
  for (const cells of rawRows) {
    const path = cells[0];
    const hits = toCount(cells[1]);
    if (path == null || hits === 0) continue;
    byPath[path] = (byPath[path] ?? 0) + hits;
  }

  return Object.entries(byPath).map(([path, hits]) => ({ path, hits }));
}

export interface SitemapMonthCounts {
  readonly path: string;
  readonly month: string;
  readonly days: Record<string, number>;
  readonly hits: number;
}

/**
 * Build an Athena statement that counts hits per `(day-of-month, path)` across
 * a whole `YYYY-MM`, restricted to the given sitemap paths. One scan of the
 * month's partitions replaces 720 single-hour scans, which is why backfill uses
 * this instead of {@link buildSitemapHourlyQuery}. The log-side URI is
 * slash-collapsed in SQL via {@link canonicalUriExpr} in both the `WHERE ... IN`
 * and the `GROUP BY`. An empty `paths` yields a valid zero-row statement.
 */
export function buildSitemapMonthlyQuery({
  table,
  source,
  monthKey,
  paths,
}: {
  table: string;
  source: AppliedSource;
  monthKey: string;
  paths: Array<string>;
}): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (match == null) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }
  const [, year, month] = match;
  if (year == null || month == null) {
    throw new Error(`Invalid monthKey: ${monthKey}`);
  }

  const columns = columnMaps[source];
  const canonicalUri = canonicalUriExpr(columns.uriStem);
  const dayExpr = source === "v2" ? "day" : `day_of_month(CAST("date" AS date))`;
  const monthPredicate =
    source === "v2"
      ? `year = '${year}' AND month = '${month}'`
      : `"date" BETWEEN DATE '${year}-${month}-01' AND DATE '${year}-${month}-31'`;

  const whereClause =
    paths.length === 0
      ? "1 = 0"
      : `${monthPredicate} AND ${canonicalUri} IN (${paths.map((path) => `'${escapeSqlString(path)}'`).join(", ")})`;

  return [
    "SELECT",
    `  ${dayExpr} AS day_value,`,
    `  ${canonicalUri} AS path_value,`,
    "  count(*) AS hits",
    `FROM "${table}"`,
    `WHERE ${whereClause}`,
    `GROUP BY ${dayExpr}, ${canonicalUri}`,
  ].join("\n");
}

/**
 * Run {@link buildSitemapMonthlyQuery} and reshape the rows into one
 * {@link SitemapMonthCounts} per path, with day-of-month zero-padded to `dd`.
 * Short-circuits to `[]` without calling Athena when `paths` is empty.
 */
export async function runSitemapMonthlyQuery({
  athena,
  database,
  table,
  workgroup,
  outputLocation,
  source,
  monthKey,
  paths,
}: {
  athena: Pick<AthenaClient, "send">;
  database: string;
  table: string;
  workgroup: string;
  outputLocation?: string;
  source: AppliedSource;
  monthKey: string;
  paths: Array<string>;
}): Promise<Array<SitemapMonthCounts>> {
  if (paths.length === 0) {
    return [];
  }

  const queryString = buildSitemapMonthlyQuery({ table, source, monthKey, paths });
  const rawRows = await startAndFetchRows({
    athena,
    database,
    workgroup,
    outputLocation,
    queryString,
  });

  const byPath: Record<string, { days: Record<string, number>; hits: number }> = {};
  for (const cells of rawRows) {
    const dayCell = cells[0];
    const path = cells[1];
    const hits = toCount(cells[2]);
    if (path == null || dayCell == null || hits === 0) continue;

    const dayKey = String(dayCell).padStart(2, "0");
    const existing = byPath[path] ?? { days: {}, hits: 0 };
    existing.days[dayKey] = (existing.days[dayKey] ?? 0) + hits;
    existing.hits += hits;
    byPath[path] = existing;
  }

  return Object.entries(byPath).map(([path, entry]) => ({
    path,
    month: monthKey,
    days: entry.days,
    hits: entry.hits,
  }));
}

export interface ProcessSitemapModels {
  readonly sitemapUrlStats: Pick<SitemapUrlStats, "buildAdd">;
  readonly markers: Pick<AppliedMarkers, "isApplied" | "buildMarkerPut">;
}

export interface ProcessSitemapAthena {
  readonly client: Pick<AthenaClient, "send">;
  readonly database: string;
  readonly table: string;
  readonly workgroup: string;
  readonly outputLocation?: string;
}

export interface ProcessSitemapOptions {
  readonly markerTtlDays?: number;
}

/**
 * Incrementally add a single UTC hour's per-path hits to each sitemap URL's
 * `(path, month)` item, guarded by an applied-marker so the hour is counted at
 * most once. Returns `{ status: "skipped" }` when the hour is already applied,
 * and `{ status: "applied", urls }` otherwise (`urls: 0` when nothing matched).
 */
export async function processSitemapHour({
  hourKey,
  source,
  paths,
  models,
  athena,
  options,
  dynamo,
}: {
  hourKey: string;
  source: AppliedSource;
  paths: Array<string>;
  models: ProcessSitemapModels;
  athena: ProcessSitemapAthena;
  options?: ProcessSitemapOptions;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<{ status: "applied" | "skipped"; urls: number }> {
  const alreadyApplied = await models.markers.isApplied({ grain: "sitemap", periodKey: hourKey });
  if (alreadyApplied) return { status: "skipped", urls: 0 };

  const parts = hourKeyParts(hourKey);
  const counts =
    paths.length === 0
      ? []
      : await runSitemapHourlyQuery({
          athena: athena.client,
          database: athena.database,
          table: athena.table,
          workgroup: athena.workgroup,
          outputLocation: athena.outputLocation,
          source,
          hourKey,
          paths,
        });

  const ttl = computeMarkerTtl(options?.markerTtlDays);
  const markerPut = models.markers.buildMarkerPut({
    grain: "sitemap",
    periodKey: hourKey,
    source,
    ttl,
  });

  const addUpdates = counts.map((count) =>
    models.sitemapUrlStats.buildAdd({
      path: count.path,
      month: parts.monthKey,
      dayAttr: parts.dayAttr,
      hits: count.hits,
    }),
  );

  const result = await sendTransacted({ dynamo, leading: [markerPut], rest: addUpdates });
  return { status: result.status, urls: result.status === "applied" ? counts.length : 0 };
}

export interface ProcessSitemapMonthModels {
  readonly sitemapUrlStats: Pick<SitemapUrlStats, "overwriteMany">;
}

/**
 * Recompute a whole month's per-day hits in a single Athena scan and overwrite
 * each `(path, month)` item with `SET`. This is the backfill path: one scan of
 * the month replaces 720 single-hour scans, and `SET` is idempotent so reruns
 * are safe and no applied-marker is needed. The live hourly cron uses
 * {@link processSitemapHour} (incremental `ADD`) instead, because going forward
 * it only ever has one new hour of data. Returns `{ urls: 0 }` without calling
 * Athena when `paths` is empty.
 */
export async function processSitemapMonth({
  monthKey,
  source,
  paths,
  models,
  athena,
}: {
  monthKey: string;
  source: AppliedSource;
  paths: Array<string>;
  models: ProcessSitemapMonthModels;
  athena: ProcessSitemapAthena;
}): Promise<{ urls: number }> {
  if (paths.length === 0) {
    return { urls: 0 };
  }

  const counts = await runSitemapMonthlyQuery({
    athena: athena.client,
    database: athena.database,
    table: athena.table,
    workgroup: athena.workgroup,
    outputLocation: athena.outputLocation,
    source,
    monthKey,
    paths,
  });

  await models.sitemapUrlStats.overwriteMany(counts);

  return { urls: counts.length };
}

export const sitemapUrlStatSchema = v.looseObject({
  pk: v.string(),
  sk: v.string(),
  path: v.string(),
  month: v.string(),
  hits: v.number(),
  updatedAt: v.number(),
});
export type SitemapUrlStat = v.InferOutput<typeof sitemapUrlStatSchema>;

export interface SitemapUrlStatRecord {
  readonly pk: string;
  readonly sk: string;
  readonly path: string;
  readonly month: string;
  readonly hits: number;
  readonly updatedAt: number;
  readonly days: Record<string, number>;
}

export class SitemapUrlStats {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  readonly buildAdd = ({
    path,
    month,
    dayAttr,
    hits,
  }: {
    readonly path: string;
    readonly month: string;
    readonly dayAttr: string;
    readonly hits: number;
  }): TransactItem => {
    const update: UpdateMembers = {
      TableName: this.props.tableName,
      Key: { pk: partitionKey(path), sk: month },
      UpdateExpression:
        "SET #path = :path, #month = :month, #updatedAt = :now ADD #hits :hits, #day :hits",
      ExpressionAttributeNames: {
        "#path": "path",
        "#month": "month",
        "#updatedAt": "updatedAt",
        "#hits": "hits",
        "#day": dayAttr,
      },
      ExpressionAttributeValues: {
        ":path": path,
        ":month": month,
        ":now": Date.now(),
        ":hits": hits,
      },
    };
    return { Update: update };
  };

  readonly overwriteMany = async (stats: Array<SitemapMonthCounts>): Promise<void> => {
    for (const stat of stats) {
      await this.props.dynamo.send(new UpdateCommand(this.buildOverwrite(stat)));
    }
  };

  readonly buildOverwrite = ({
    path,
    month,
    days,
    hits,
  }: {
    readonly path: string;
    readonly month: string;
    readonly days: Record<string, number>;
    readonly hits: number;
  }): UpdateMembers => {
    const names: Record<string, string> = {
      "#path": "path",
      "#month": "month",
      "#hits": "hits",
      "#updatedAt": "updatedAt",
    };
    const valuesMap: Record<string, unknown> = {
      ":path": path,
      ":month": month,
      ":hits": hits,
      ":now": Date.now(),
    };
    const setParts = ["#path = :path", "#month = :month", "#hits = :hits", "#updatedAt = :now"];

    for (const [dayKey, count] of Object.entries(days)) {
      const dayAttr = `d${dayKey}`;
      names[`#${dayAttr}`] = dayAttr;
      valuesMap[`:${dayAttr}`] = count;
      setParts.push(`#${dayAttr} = :${dayAttr}`);
    }

    return {
      TableName: this.props.tableName,
      Key: { pk: partitionKey(path), sk: month },
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: valuesMap,
    };
  };

  readonly getForUrl = async ({
    path,
    startMonth,
    endMonth,
  }: {
    readonly path: string;
    readonly startMonth: string;
    readonly endMonth: string;
  }): Promise<Array<SitemapUrlStatRecord>> => {
    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: {
          ":pk": partitionKey(path),
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
  }): Promise<Array<SitemapUrlStatRecord>> => {
    if (this.props.reverseIndexName == null) {
      throw new Error("getForMonth requires a reverseIndexName");
    }

    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :month",
        ExpressionAttributeNames: { "#sk": "sk" },
        ExpressionAttributeValues: { ":month": month },
      },
    });

    return items.map((item) => this.parseOne(item));
  };

  private readonly parseOne = (item: unknown): SitemapUrlStatRecord => {
    const result = v.safeParse(sitemapUrlStatSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored sitemap url stat record");
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
      path: result.output.path,
      month: result.output.month,
      hits: result.output.hits,
      updatedAt: result.output.updatedAt,
      days,
    };
  };
}

function partitionKey(path: string): string {
  return `sitemapurl#${path}`;
}

const locPattern = /<loc>([\s\S]*?)<\/loc>/gi;
const sitemapIndexPattern = /<sitemapindex/i;

const xmlEntities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function unescapeXml(value: string): string {
  return value.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => xmlEntities[entity] ?? entity);
}

function canonicalUriExpr(uriColumn: string): string {
  return `CASE WHEN length(${uriColumn}) > 1 AND substr(${uriColumn}, -1) = '/' THEN substr(${uriColumn}, 1, length(${uriColumn}) - 1) ELSE ${uriColumn} END`;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function toCount(value: string | undefined): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const defaultMarkerTtlDays = 90;

function computeMarkerTtl(markerTtlDays?: number): number {
  const days = markerTtlDays ?? defaultMarkerTtlDays;
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}
