import type { WatchStatsRecord } from "@beesolve/analytics-processor";

export const watchGrains = ["day", "month", "year"] as const;
export type WatchGrain = (typeof watchGrains)[number];

export interface WatchBucket {
  readonly key: string;
  readonly hits: number;
}

export function isWatchGrain(value: string | null): value is WatchGrain {
  return value != null && (watchGrains as ReadonlyArray<string>).includes(value);
}

function pad2(input: number): string {
  return input.toString().padStart(2, "0");
}

function pad4(input: number): string {
  return input.toString().padStart(4, "0");
}

export function periodKeyFor({
  grain,
  date,
}: {
  readonly grain: WatchGrain;
  readonly date: Date;
}): string {
  const year = pad4(date.getUTCFullYear());
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  if (grain === "year") return year;
  if (grain === "month") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

export function defaultWatchPeriodKey({
  grain,
  now,
}: {
  readonly grain: WatchGrain;
  readonly now: Date;
}): string {
  return periodKeyFor({ grain, date: now });
}

/**
 * The `[startMonth, endMonth]` span of monthly watch records that fully covers
 * a single period at the chosen grain. Watch metrics persist as monthly records
 * (with per-day `dNN` attributes for `hits`), so a day sits inside its own
 * month, a month is itself, and a year spans its twelve months.
 */
export function monthSpanForPeriod({
  grain,
  periodKey,
}: {
  readonly grain: WatchGrain;
  readonly periodKey: string;
}): { startMonth: string; endMonth: string } {
  if (grain === "year") {
    const year = periodKey.slice(0, 4);
    return { startMonth: `${year}-01`, endMonth: `${year}-12` };
  }
  const month = periodKey.slice(0, 7);
  return { startMonth: month, endMonth: month };
}

/**
 * Hits for a single bucket within one period, read from its monthly records.
 * - day: the matching `dNN` entry inside that month's `days` map
 * - month: the month record's `hits`
 * - year: the sum of every month record's `hits` in the year
 */
export function hitsForPeriod({
  grain,
  periodKey,
  records,
}: {
  readonly grain: WatchGrain;
  readonly periodKey: string;
  readonly records: Array<WatchStatsRecord>;
}): number {
  if (grain === "day") {
    const month = periodKey.slice(0, 7);
    const day = periodKey.slice(8, 10);
    const record = records.find((candidate) => candidate.month === month);
    return record?.days[day] ?? 0;
  }

  if (grain === "month") {
    const month = periodKey.slice(0, 7);
    const record = records.find((candidate) => candidate.month === month);
    return record?.hits ?? 0;
  }

  const year = periodKey.slice(0, 4);
  return records
    .filter((candidate) => candidate.month.slice(0, 4) === year)
    .reduce((sum, record) => sum + record.hits, 0);
}

export interface WatchScalarTotals {
  readonly bytesSent: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
  readonly bytesSaved: number;
  readonly errors: number;
  readonly redirects: number;
}

const emptyScalars: WatchScalarTotals = {
  bytesSent: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheErrors: 0,
  bytesSaved: 0,
  errors: 0,
  redirects: 0,
};

/**
 * Month-level scalar metrics (bytes, cache counts, saved bytes) projected to a
 * period. These metrics are only stored at month granularity, so they cannot be
 * broken down per day. A `day` period therefore reports the containing month's
 * scalars; a `month` period reports that month; a `year` period sums its months.
 * Hits are the one metric with day granularity and come from
 * {@link hitsForPeriod}, not this projection.
 */
export function scalarsForPeriod({
  grain,
  periodKey,
  records,
}: {
  readonly grain: WatchGrain;
  readonly periodKey: string;
  readonly records: Array<WatchStatsRecord>;
}): WatchScalarTotals {
  if (grain === "year") {
    const year = periodKey.slice(0, 4);
    return records
      .filter((candidate) => candidate.month.slice(0, 4) === year)
      .reduce((sum, record) => addScalars(sum, record), emptyScalars);
  }

  const month = periodKey.slice(0, 7);
  const record = records.find((candidate) => candidate.month === month);
  if (record == null) return emptyScalars;
  return addScalars(emptyScalars, record);
}

function addScalars(sum: WatchScalarTotals, record: WatchStatsRecord): WatchScalarTotals {
  return {
    bytesSent: sum.bytesSent + record.bytesSent,
    cacheHits: sum.cacheHits + record.cacheHits,
    cacheMisses: sum.cacheMisses + record.cacheMisses,
    cacheErrors: sum.cacheErrors + record.cacheErrors,
    bytesSaved: sum.bytesSaved + record.bytesSaved,
    errors: sum.errors + record.errors,
    redirects: sum.redirects + record.redirects,
  };
}

/**
 * The ordered bucket keys for a trend window of `size` periods ending at
 * `anchorKey` (inclusive), oldest first. Daily windows walk calendar days,
 * monthly windows walk months, yearly windows walk years.
 */
export function trendBucketKeys({
  grain,
  anchorKey,
  size,
}: {
  readonly grain: WatchGrain;
  readonly anchorKey: string;
  readonly size: number;
}): Array<string> {
  const anchor = parseKey({ grain, key: anchorKey });
  const keys: Array<string> = [];
  for (let offset = size - 1; offset >= 0; offset -= 1) {
    keys.push(periodKeyFor({ grain, date: shift({ grain, date: anchor, delta: -offset }) }));
  }
  return keys;
}

/** The `[startMonth, endMonth]` span covering a whole trend window at once. */
export function monthSpanForWindow({
  grain,
  bucketKeys,
}: {
  readonly grain: WatchGrain;
  readonly bucketKeys: Array<string>;
}): { startMonth: string; endMonth: string } {
  const first = bucketKeys[0] ?? "";
  const last = bucketKeys[bucketKeys.length - 1] ?? first;
  const start = monthSpanForPeriod({ grain, periodKey: first }).startMonth;
  const end = monthSpanForPeriod({ grain, periodKey: last }).endMonth;
  return { startMonth: start, endMonth: end };
}

export function defaultWindowSize(grain: WatchGrain): number {
  if (grain === "day") return 30;
  if (grain === "month") return 12;
  return 5;
}

function parseKey({ grain, key }: { readonly grain: WatchGrain; readonly key: string }): Date {
  const year = Number(key.slice(0, 4));
  const month = grain === "year" ? 1 : Number(key.slice(5, 7));
  const day = grain === "day" ? Number(key.slice(8, 10)) : 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shift({
  grain,
  date,
  delta,
}: {
  readonly grain: WatchGrain;
  readonly date: Date;
  readonly delta: number;
}): Date {
  const next = new Date(date.getTime());
  if (grain === "day") next.setUTCDate(next.getUTCDate() + delta);
  else if (grain === "month") next.setUTCMonth(next.getUTCMonth() + delta);
  else next.setUTCFullYear(next.getUTCFullYear() + delta);
  return next;
}
