import type { AppliedMarkers } from "./appliedMarkers.ts";
import type { Breakdowns } from "./breakdowns.ts";
import type { Dimension, Grain, Tier } from "./keys.ts";
import { defaultTier } from "./keys.ts";
import type { BreakdownRow, SummedTotals } from "./reduce.ts";
import { sumBreakdown, sumTotals } from "./reduce.ts";
import type { Totals, TotalsItem } from "./totals.ts";

export type View = Grain | "year";

/**
 * How a bucket's value was obtained, so the UI can tell "no traffic" apart from
 * "not calculated yet":
 * - `sealed`: a finalized, rolled-up period read from its stored aggregate. A
 *   zero-hit sealed bucket is genuine "no traffic".
 * - `partial`: an in-progress period computed live from the finer grain; the
 *   value is real but may still grow.
 * - `pending`: a period past its expected processing time with no stored data
 *   and nothing computable yet — awaiting processing.
 */
export const bucketStates = ["sealed", "partial", "pending"] as const;
export type BucketState = (typeof bucketStates)[number];

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
  cacheHits: 0,
  cacheMisses: 0,
  cacheErrors: 0,
};

/**
 * Resolves one bucket's totals, computing an in-progress period on the fly from
 * exactly one grain finer, following only the current edge deeper.
 *
 * A sealed period (strictly past, rollup marker applied) is read from its stored
 * aggregate. Otherwise the period is the sum of its children at the next finer
 * grain, where every already-complete child is taken from its stored aggregate
 * and only the single in-progress child is resolved recursively:
 *
 * - partial day   = stored/queried hours `00..currentHour`
 * - partial month = stored days `01..currentDay-1` + the partial current day
 * - partial year  = stored months `01..currentMonth-1` + the partial current month
 *
 * So a partial month never fans out to hours for its finished days (it trusts
 * their day aggregate) — only the one current day drills into hours. Each level
 * is one ranged query, keeping the read count bounded (a year touches ~12
 * months + ~31 days + ~24 hours) and the request sub-second.
 */
export async function resolveTotalsLive({
  models,
  grain,
  periodKey,
  now,
  tier = defaultTier,
}: {
  readonly models: ResolveModels;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
  readonly tier?: Tier;
}): Promise<SummedTotals> {
  if (grain === "hour") {
    const stored = await models.totals.getOne({ grain: "hour", timeKey: periodKey, tier });
    return stored == null ? emptyTotals : pickTotals(stored);
  }

  if (await isSealed({ models, grain, periodKey, now, tier })) {
    const stored = await models.totals.getOne({ grain, timeKey: periodKey, tier });
    if (stored != null) return pickTotals(stored);
  }

  if (grain === "day") {
    const lastHour = isCurrentPeriod({ grain: "day", periodKey, now }) ? now.getUTCHours() : 23;
    const hours = await models.totals.queryWindow({
      grain: "hour",
      startKey: `${periodKey}-00`,
      endKey: `${periodKey}-${pad2(lastHour)}`,
      tier,
    });
    return sumTotals(hours);
  }

  const storedDays = await models.totals.queryWindow({
    grain: "day",
    startKey: `${periodKey}-01`,
    endKey: `${periodKey}-31`,
    tier,
  });
  const base = sumTotals(
    storedDays.filter((item) => !isCurrentPeriod({ grain: "day", periodKey: item.timeKey, now })),
  );

  const currentDayKey = currentChildKey({ parentGrain: "month", periodKey, now });
  if (currentDayKey == null) return base;

  const currentDay = await resolveTotalsLive({
    models,
    grain: "day",
    periodKey: currentDayKey,
    now,
    tier,
  });
  return sumTotals([base, currentDay]);
}

export async function resolveBreakdownLive({
  models,
  dimension,
  grain,
  periodKey,
  now,
  tier = defaultTier,
}: {
  readonly models: ResolveModels;
  readonly dimension: Dimension;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
  readonly tier?: Tier;
}): Promise<Array<BreakdownRow>> {
  if (grain === "hour") {
    return toRows(
      await models.breakdowns.getForPeriod({ dimension, grain: "hour", periodKey, tier }),
    );
  }

  if (await isSealed({ models, grain, periodKey, now, tier })) {
    const stored = await models.breakdowns.getForPeriod({ dimension, grain, periodKey, tier });
    if (stored.length > 0) return toRows(stored);
  }

  if (grain === "day") {
    const hourKeys = hourKeysInProgress({ periodKey, now });
    const hourRows = await Promise.all(
      hourKeys.map((hourKey) =>
        models.breakdowns.getForPeriod({ dimension, grain: "hour", periodKey: hourKey, tier }),
      ),
    );
    return sumBreakdown(hourRows.flat().map(toRow));
  }

  const storedDayKeys = pastDayKeys({ periodKey, now });
  const storedDayRows = await Promise.all(
    storedDayKeys.map((dayKey) =>
      models.breakdowns.getForPeriod({ dimension, grain: "day", periodKey: dayKey, tier }),
    ),
  );
  const rows = storedDayRows.flat().map(toRow);

  const currentDayKey = currentChildKey({ parentGrain: "month", periodKey, now });
  if (currentDayKey != null) {
    const currentDay = await resolveBreakdownLive({
      models,
      dimension,
      grain: "day",
      periodKey: currentDayKey,
      now,
      tier,
    });
    rows.push(...currentDay);
  }

  return sumBreakdown(rows);
}

/**
 * Classifies a bucket as sealed / partial / pending without recomputing its
 * value. A sealed bucket is a finalized rollup (its marker is applied), so a
 * zero-hit sealed bucket is genuine "no traffic". A non-sealed bucket that
 * yielded data is in-progress (`partial`); one with nothing to show is awaiting
 * processing (`pending`).
 */
export async function classifyBucketState({
  models,
  grain,
  periodKey,
  now,
  hasData,
  tier = defaultTier,
}: {
  readonly models: ResolveModels;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
  readonly hasData: boolean;
  readonly tier?: Tier;
}): Promise<BucketState> {
  if (await isSealed({ models, grain, periodKey, now, tier })) return "sealed";
  if (hasData) return "partial";
  return "pending";
}

async function isSealed({
  models,
  grain,
  periodKey,
  now,
  tier = defaultTier,
}: {
  readonly models: ResolveModels;
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
  readonly tier?: Tier;
}): Promise<boolean> {
  if (!isPastPeriod({ grain, periodKey, now })) return false;
  return models.markers.isApplied({ grain, periodKey, tier });
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

function isPastPeriod({
  grain,
  periodKey,
  now,
}: {
  readonly grain: Grain;
  readonly periodKey: string;
  readonly now: Date;
}): boolean {
  return periodKey < currentKeyFor({ grain, now });
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

/**
 * The in-progress child key of a parent period, or `null` if the parent is a
 * past period (all its children are complete). Only the current month exposes a
 * current day; a past month has none.
 */
function currentChildKey({
  parentGrain,
  periodKey,
  now,
}: {
  readonly parentGrain: "month";
  readonly periodKey: string;
  readonly now: Date;
}): string | null {
  if (!isCurrentPeriod({ grain: parentGrain, periodKey, now })) return null;
  return currentKeyFor({ grain: "day", now });
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

function pastDayKeys({
  periodKey,
  now,
}: {
  readonly periodKey: string;
  readonly now: Date;
}): Array<string> {
  const isCurrentMonth = isCurrentPeriod({ grain: "month", periodKey, now });
  const lastDay = isCurrentMonth ? now.getUTCDate() - 1 : daysInMonth(periodKey);
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

function toRow(item: { value: string; hits: number; bytes: number }): BreakdownRow {
  return { value: item.value, hits: item.hits, bytes: item.bytes };
}

function toRows(items: Array<{ value: string; hits: number; bytes: number }>): Array<BreakdownRow> {
  return items.map(toRow);
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
    cacheHits: item.cacheHits,
    cacheMisses: item.cacheMisses,
    cacheErrors: item.cacheErrors,
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad4(value: number): string {
  return value.toString().padStart(4, "0");
}
