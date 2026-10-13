import type { AppliedMarkers } from "./appliedMarkers.ts";
import type { Breakdowns } from "./breakdowns.ts";
import type { Dimension, Grain } from "./keys.ts";
import type { BreakdownRow, SummedTotals } from "./reduce.ts";
import { sumBreakdown, sumTotals } from "./reduce.ts";
import type { Totals, TotalsItem } from "./totals.ts";

export type View = Grain | "year";

export interface ResolveModels {
  readonly totals: Pick<Totals, "queryWindow" | "getOne">;
  readonly breakdowns: Pick<Breakdowns, "getForPeriod">;
  readonly markers: Pick<AppliedMarkers, "isApplied">;
}

const emptyTotals: SummedTotals = {
  hits: 0,
  success: 0,
  errors: 0,
  errors4xx: 0,
  errors5xx: 0,
  bytesSent: 0,
  bytesReceived: 0,
};

/**
 * Resolves one bucket's totals, computing an in-progress period on the fly from
 * the grain below it. A past period whose rollup marker is applied is read
 * directly from the stored aggregate ("sealed"); the current period, and any
 * past period still missing its marker, is summed from its children — the
 * current month folds down through the current day to the hours ingested so far.
 *
 * Each level reads its children with a single ranged query (never a get per
 * child): a day sums its hours via one hourly `queryWindow`; a month sums its
 * days, and the one in-progress day among them is resolved from hours. `hour`
 * is terminal.
 */
export async function resolveTotalsLive({
  models,
  grain,
  periodKey,
  now,
}: {
  readonly models: ResolveModels;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
}): Promise<SummedTotals> {
  if (grain === "hour") {
    const stored = await models.totals.getOne({ grain: "hour", timeKey: periodKey });
    return stored == null ? emptyTotals : pickTotals(stored);
  }

  if (await isSealed({ models, grain, periodKey, now })) {
    const stored = await models.totals.getOne({ grain, timeKey: periodKey });
    if (stored != null) return pickTotals(stored);
  }

  if (grain === "day") {
    const lastHour = isCurrentPeriod({ grain: "day", periodKey, now }) ? now.getUTCHours() : 23;
    const hours = await models.totals.queryWindow({
      grain: "hour",
      startKey: `${periodKey}-00`,
      endKey: `${periodKey}-${pad2(lastHour)}`,
    });
    return sumTotals(hours);
  }

  const dayKeys = dayKeysInProgress({ periodKey, now });
  const sealedDays = await models.totals.queryWindow({
    grain: "day",
    startKey: `${periodKey}-01`,
    endKey: `${periodKey}-31`,
  });
  const sealedByKey = indexByTimeKey(sealedDays);

  const resolvedDays = await Promise.all(
    dayKeys.map(async (dayKey) => {
      const stored = sealedByKey[dayKey];
      if (stored != null && !isCurrentPeriod({ grain: "day", periodKey: dayKey, now })) {
        return pickTotals(stored);
      }
      return resolveTotalsLive({ models, grain: "day", periodKey: dayKey, now });
    }),
  );
  return sumTotals(resolvedDays);
}

export async function resolveBreakdownLive({
  models,
  dimension,
  grain,
  periodKey,
  now,
}: {
  readonly models: ResolveModels;
  readonly dimension: Dimension;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
}): Promise<Array<BreakdownRow>> {
  if (grain === "hour") {
    return toRows(await models.breakdowns.getForPeriod({ dimension, grain: "hour", periodKey }));
  }

  if (await isSealed({ models, grain, periodKey, now })) {
    const stored = await models.breakdowns.getForPeriod({ dimension, grain, periodKey });
    if (stored.length > 0) return toRows(stored);
  }

  const finer = finerGrain(grain);
  const childKeys =
    grain === "day"
      ? hourKeysInProgress({ periodKey, now })
      : dayKeysInProgress({ periodKey, now });

  const children = await Promise.all(
    childKeys.map((childKey) =>
      resolveBreakdownLive({ models, dimension, grain: finer, periodKey: childKey, now }),
    ),
  );
  return sumBreakdown(children.flat());
}

async function isSealed({
  models,
  grain,
  periodKey,
  now,
}: {
  readonly models: ResolveModels;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
}): Promise<boolean> {
  if (isCurrentPeriod({ grain, periodKey, now })) return false;
  return models.markers.isApplied({ grain, periodKey });
}

function isCurrentPeriod({
  grain,
  periodKey,
  now,
}: {
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
}): boolean {
  return periodKey === currentKeyFor({ grain, now });
}

function currentKeyFor({ grain, now }: { readonly grain: Grain; readonly now: Date }): string {
  const year = pad4(now.getUTCFullYear());
  const month = pad2(now.getUTCMonth() + 1);
  const day = pad2(now.getUTCDate());
  const hour = pad2(now.getUTCHours());
  if (grain === "month") return `${year}-${month}`;
  if (grain === "day") return `${year}-${month}-${day}`;
  return `${year}-${month}-${day}-${hour}`;
}

function finerGrain(grain: "day" | "month"): Grain {
  return grain === "month" ? "day" : "hour";
}

function hourKeysInProgress({
  periodKey,
  now,
}: {
  readonly periodKey: string;
  readonly now: Date;
}): Array<string> {
  const lastHour = isCurrentPeriod({ grain: "day", periodKey, now }) ? now.getUTCHours() : 23;
  const keys: Array<string> = [];
  for (let hour = 0; hour <= lastHour; hour += 1) {
    keys.push(`${periodKey}-${pad2(hour)}`);
  }
  return keys;
}

function dayKeysInProgress({
  periodKey,
  now,
}: {
  readonly periodKey: string;
  readonly now: Date;
}): Array<string> {
  const lastDay = isCurrentPeriod({ grain: "month", periodKey, now })
    ? now.getUTCDate()
    : daysInMonth(periodKey);
  const keys: Array<string> = [];
  for (let day = 1; day <= lastDay; day += 1) {
    keys.push(`${periodKey}-${pad2(day)}`);
  }
  return keys;
}

function daysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
}

function indexByTimeKey(items: Array<TotalsItem>): Record<string, TotalsItem> {
  const byKey: Record<string, TotalsItem> = {};
  for (const item of items) {
    byKey[item.timeKey] = item;
  }
  return byKey;
}

function toRows(items: Array<{ value: string; hits: number; bytes: number }>): Array<BreakdownRow> {
  return items.map((item) => ({ value: item.value, hits: item.hits, bytes: item.bytes }));
}

function pickTotals(item: TotalsItem): SummedTotals {
  return {
    hits: item.hits,
    success: item.success,
    errors: item.errors,
    errors4xx: item.errors4xx,
    errors5xx: item.errors5xx,
    bytesSent: item.bytesSent,
    bytesReceived: item.bytesReceived,
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad4(value: number): string {
  return value.toString().padStart(4, "0");
}
