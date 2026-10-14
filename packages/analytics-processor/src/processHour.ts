import type { AthenaClient } from "@aws-sdk/client-athena";
import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { splitArrayToChunks } from "@beesolve/helpers";
import type { IpInfoCache } from "@beesolve/ip-info";

import type { AppliedMarkers } from "./appliedMarkers.ts";
import { runHourlyAthenaQuery } from "./athena.ts";
import type { BreakdownInput, BreakdownItem, Breakdowns } from "./breakdowns.ts";
import type { Config } from "./config.ts";
import type { Dimension } from "./keys.ts";
import type { BreakdownRow } from "./reduce.ts";
import { sumBreakdown, sumTotals } from "./reduce.ts";
import type { Totals } from "./totals.ts";

export type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export interface ProcessHourModels {
  readonly totals: Pick<Totals, "buildHourlyUpdate">;
  readonly breakdowns: Pick<Breakdowns, "buildUpdates">;
  readonly markers: Pick<AppliedMarkers, "isApplied" | "buildMarkerPut">;
  readonly ipCache: Pick<IpInfoCache, "enrichMany">;
  readonly config?: Pick<Config, "ensureStart">;
}

export interface ProcessHourAthena {
  readonly client: Pick<AthenaClient, "send">;
  readonly database: string;
  readonly table: string;
  readonly workgroup: string;
  readonly outputLocation?: string;
}

export interface ProcessHourOptions {
  readonly topPaths: number;
  readonly hourlyTtlDays: number;
  readonly ipInfoApiKey?: string;
}

export interface ProcessHourResult {
  readonly status: "applied" | "skipped";
}

const transactionLimit = 100;
const unresolvedCountry = "ZZ";

export async function processHour({
  hourKey,
  models,
  athena,
  options,
  dynamo,
}: {
  hourKey: string;
  models: ProcessHourModels;
  athena: ProcessHourAthena;
  options: ProcessHourOptions;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<ProcessHourResult> {
  const alreadyApplied = await models.markers.isApplied({ grain: "hour", periodKey: hourKey });
  if (alreadyApplied) return { status: "skipped" };

  const query = await runHourlyAthenaQuery({
    athena: athena.client,
    database: athena.database,
    table: athena.table,
    workgroup: athena.workgroup,
    outputLocation: athena.outputLocation,
    hourKey,
    topPaths: options.topPaths,
  });

  const byCountry = await resolveCountryBreakdown({
    topIps: query.topIps,
    ipCache: models.ipCache,
    hasApiKey: options.ipInfoApiKey != null,
  });

  const ttl = computeHourlyTtl(options.hourlyTtlDays);

  const markerPut = models.markers.buildMarkerPut({
    grain: "hour",
    periodKey: hourKey,
    ttl,
  });

  const totalsUpdate = models.totals.buildHourlyUpdate({
    item: {
      timeKey: hourKey,
      hits: query.totals.hits,
      success: query.totals.success,
      errors: query.totals.errors,
      errors4xx: query.totals.errors4xx,
      errors5xx: query.totals.errors5xx,
      bytesSent: query.totals.bytesSent,
      bytesReceived: query.totals.bytesReceived,
      p50TimeTaken: query.totals.p50TimeTaken,
      p95TimeTaken: query.totals.p95TimeTaken,
      cacheHitRatio: query.totals.cacheHitRatio,
      uniqueIpCount: query.totals.uniqueIpCount,
    },
    ttl,
  });

  const breakdownUpdates = buildBreakdownUpdates({
    breakdowns: models.breakdowns,
    grain: "hour",
    periodKey: hourKey,
    ttl,
    byStatus: query.byStatus,
    byDevice: query.byDevice,
    byPath: query.byPath,
    byCountry,
  });

  const result = await sendTransacted({
    dynamo,
    leading: [markerPut, totalsUpdate],
    rest: breakdownUpdates,
  });

  if (result.status === "applied" && query.totals.hits > 0 && models.config != null) {
    await models.config.ensureStart({ hourKey });
  }

  return result;
}

export async function applyDailyRollup({
  dayKey,
  models,
  dynamo,
}: {
  dayKey: string;
  models: RollupModels;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<ProcessHourResult> {
  const alreadyApplied = await models.markers.isApplied({ grain: "day", periodKey: dayKey });
  if (alreadyApplied) return { status: "skipped" };

  const hourTotals = await models.totals.queryWindow({
    grain: "hour",
    startKey: `${dayKey}-00`,
    endKey: `${dayKey}-23`,
  });
  const summed = sumTotals(hourTotals);

  const byDimension = await aggregateFinerBreakdowns({
    breakdowns: models.breakdowns,
    grain: "hour",
    periodKeys: hourWindowKeys(dayKey),
  });

  const totalsUpdate = models.totals.buildAggregateUpdate({
    grain: "day",
    item: { timeKey: dayKey, ...summed },
  });

  const breakdownUpdates = buildBreakdownUpdates({
    breakdowns: models.breakdowns,
    grain: "day",
    periodKey: dayKey,
    byStatus: byDimension.status,
    byDevice: byDimension.device,
    byPath: byDimension.path,
    byCountry: byDimension.country,
  });

  const markerPut = models.markers.buildMarkerPut({
    grain: "day",
    periodKey: dayKey,
  });

  return sendTransacted({
    dynamo,
    leading: [markerPut, totalsUpdate],
    rest: breakdownUpdates,
  });
}

export async function applyMonthlyRollup({
  monthKey,
  models,
  dynamo,
}: {
  monthKey: string;
  models: RollupModels;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<ProcessHourResult> {
  const alreadyApplied = await models.markers.isApplied({ grain: "month", periodKey: monthKey });
  if (alreadyApplied) return { status: "skipped" };

  const dayTotals = await models.totals.queryWindow({
    grain: "day",
    startKey: `${monthKey}-01`,
    endKey: `${monthKey}-31`,
  });
  const summed = sumTotals(dayTotals);

  const byDimension = await aggregateFinerBreakdowns({
    breakdowns: models.breakdowns,
    grain: "day",
    periodKeys: dayTotals.map((item) => item.timeKey),
  });

  const totalsUpdate = models.totals.buildAggregateUpdate({
    grain: "month",
    item: { timeKey: monthKey, ...summed },
  });

  const breakdownUpdates = buildBreakdownUpdates({
    breakdowns: models.breakdowns,
    grain: "month",
    periodKey: monthKey,
    byStatus: byDimension.status,
    byDevice: byDimension.device,
    byPath: byDimension.path,
    byCountry: byDimension.country,
  });

  const markerPut = models.markers.buildMarkerPut({
    grain: "month",
    periodKey: monthKey,
  });

  return sendTransacted({
    dynamo,
    leading: [markerPut, totalsUpdate],
    rest: breakdownUpdates,
  });
}

export function chunkTransactItems({
  leading,
  rest,
  limit = transactionLimit,
}: {
  leading: Array<TransactItem>;
  rest: Array<TransactItem>;
  limit?: number;
}): Array<Array<TransactItem>> {
  const firstCapacity = Math.max(limit - leading.length, 0);
  const firstChunk = [...leading, ...rest.slice(0, firstCapacity)];
  const tail = splitArrayToChunks(rest.slice(firstCapacity), limit);
  return [firstChunk, ...tail];
}

interface RollupModels {
  readonly totals: Pick<Totals, "buildAggregateUpdate" | "queryWindow">;
  readonly breakdowns: Pick<Breakdowns, "buildUpdates" | "getForPeriod">;
  readonly markers: Pick<AppliedMarkers, "isApplied" | "buildMarkerPut">;
}

interface DimensionBreakdowns {
  readonly status: Array<BreakdownRow>;
  readonly device: Array<BreakdownRow>;
  readonly path: Array<BreakdownRow>;
  readonly country: Array<BreakdownRow>;
}

export async function sendTransacted({
  dynamo,
  leading,
  rest,
}: {
  dynamo: Pick<DynamoDBDocumentClient, "send">;
  leading: Array<TransactItem>;
  rest: Array<TransactItem>;
}): Promise<ProcessHourResult> {
  const chunks = chunkTransactItems({ leading, rest });

  try {
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      await dynamo.send(new TransactWriteCommand({ TransactItems: chunk }));
    }
  } catch (error) {
    if (isMarkerRaceError(error)) return { status: "skipped" };
    throw error;
  }

  return { status: "applied" };
}

export function isMarkerRaceError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  return name === "TransactionCanceledException" || name === "ConditionalCheckFailedException";
}

function buildBreakdownUpdates({
  breakdowns,
  grain,
  periodKey,
  ttl,
  byStatus,
  byDevice,
  byPath,
  byCountry,
}: {
  breakdowns: Pick<Breakdowns, "buildUpdates">;
  grain: "hour" | "day" | "month";
  periodKey: string;
  ttl?: number;
  byStatus: Array<BreakdownRow>;
  byDevice: Array<BreakdownRow>;
  byPath: Array<BreakdownRow>;
  byCountry: Array<BreakdownRow>;
}): Array<TransactItem> {
  const dimensionRows: Array<{ dimension: Dimension; items: Array<BreakdownInput> }> = [
    { dimension: "status", items: byStatus },
    { dimension: "device", items: byDevice },
    { dimension: "country", items: byCountry },
    { dimension: "path", items: byPath },
  ];

  const updates: Array<TransactItem> = [];
  for (const row of dimensionRows) {
    if (row.items.length === 0) continue;
    updates.push(
      ...breakdowns.buildUpdates({
        dimension: row.dimension,
        grain,
        periodKey,
        items: row.items,
        ttl,
      }),
    );
  }

  return updates;
}

async function resolveCountryBreakdown({
  topIps,
  ipCache,
  hasApiKey,
}: {
  topIps: Array<{ ip: string; hits: number }>;
  ipCache: Pick<IpInfoCache, "enrichMany">;
  hasApiKey: boolean;
}): Promise<Array<BreakdownRow>> {
  if (topIps.length === 0) return [];

  const resolved = hasApiKey
    ? await ipCache.enrichMany({ ips: topIps.map((entry) => entry.ip) })
    : {};

  const hitsByCountry: Record<string, number> = {};
  for (const entry of topIps) {
    const info = resolved[entry.ip];
    const country = info?.countryCode ?? unresolvedCountry;
    hitsByCountry[country] = (hitsByCountry[country] ?? 0) + entry.hits;
  }

  return Object.entries(hitsByCountry).map(([country, hits]) => ({
    value: country,
    hits,
    bytes: 0,
  }));
}

async function aggregateFinerBreakdowns({
  breakdowns,
  grain,
  periodKeys,
}: {
  breakdowns: Pick<Breakdowns, "getForPeriod">;
  grain: "hour" | "day";
  periodKeys: Array<string>;
}): Promise<DimensionBreakdowns> {
  const status: Array<BreakdownRow> = [];
  const device: Array<BreakdownRow> = [];
  const path: Array<BreakdownRow> = [];
  const country: Array<BreakdownRow> = [];

  for (const periodKey of periodKeys) {
    const [statusItems, deviceItems, pathItems, countryItems] = await Promise.all([
      breakdowns.getForPeriod({ dimension: "status", grain, periodKey }),
      breakdowns.getForPeriod({ dimension: "device", grain, periodKey }),
      breakdowns.getForPeriod({ dimension: "path", grain, periodKey }),
      breakdowns.getForPeriod({ dimension: "country", grain, periodKey }),
    ]);

    status.push(...statusItems.map(toBreakdownRow));
    device.push(...deviceItems.map(toBreakdownRow));
    path.push(...pathItems.map(toBreakdownRow));
    country.push(...countryItems.map(toBreakdownRow));
  }

  return {
    status: sumBreakdown(status),
    device: sumBreakdown(device),
    path: sumBreakdown(path),
    country: sumBreakdown(country),
  };
}

function hourWindowKeys(dayKey: string): Array<string> {
  const keys: Array<string> = [];
  for (let hour = 0; hour < 24; hour += 1) {
    keys.push(`${dayKey}-${hour.toString().padStart(2, "0")}`);
  }
  return keys;
}

function computeHourlyTtl(hourlyTtlDays: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds + hourlyTtlDays * 24 * 60 * 60;
}

function toBreakdownRow(item: BreakdownItem): BreakdownRow {
  return { value: item.value, hits: item.hits, bytes: item.bytes };
}
