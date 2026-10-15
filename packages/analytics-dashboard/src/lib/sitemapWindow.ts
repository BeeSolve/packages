import type { SitemapUrlStatRecord } from "@beesolve/analytics-processor";

export const sitemapGrains = ["day", "month", "year"] as const;
export type SitemapGrain = (typeof sitemapGrains)[number];

export interface SitemapBucket {
  readonly key: string;
  readonly hits: number;
}

export function isSitemapGrain(value: string | null): value is SitemapGrain {
  return value != null && (sitemapGrains as ReadonlyArray<string>).includes(value);
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
  readonly grain: SitemapGrain;
  readonly date: Date;
}): string {
  const year = pad4(date.getUTCFullYear());
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  if (grain === "year") return year;
  if (grain === "month") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

export function defaultSitemapPeriodKey({
  grain,
  now,
}: {
  readonly grain: SitemapGrain;
  readonly now: Date;
}): string {
  return periodKeyFor({ grain, date: now });
}

/**
 * The `[startMonth, endMonth]` span of monthly sitemap items that fully covers
 * a single period at the chosen grain. The store only persists monthly items
 * (with per-day `dNN` attributes), so a day sits inside its own month, a month
 * is itself, and a year spans its twelve months.
 */
export function monthSpanForPeriod({
  grain,
  periodKey,
}: {
  readonly grain: SitemapGrain;
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
 * Hits for a single path within one period, read from its monthly records.
 * - day: the matching `dNN` entry inside that month's `days` map
 * - month: the month record's `hits`
 * - year: the sum of every month record's `hits` in the year
 */
export function hitsForPeriod({
  grain,
  periodKey,
  records,
}: {
  readonly grain: SitemapGrain;
  readonly periodKey: string;
  readonly records: Array<SitemapUrlStatRecord>;
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
  readonly grain: SitemapGrain;
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
  readonly grain: SitemapGrain;
  readonly bucketKeys: Array<string>;
}): { startMonth: string; endMonth: string } {
  const first = bucketKeys[0] ?? "";
  const last = bucketKeys[bucketKeys.length - 1] ?? first;
  const start = monthSpanForPeriod({ grain, periodKey: first }).startMonth;
  const end = monthSpanForPeriod({ grain, periodKey: last }).endMonth;
  return { startMonth: start, endMonth: end };
}

export function defaultWindowSize(grain: SitemapGrain): number {
  if (grain === "day") return 30;
  if (grain === "month") return 12;
  return 5;
}

function parseKey({ grain, key }: { readonly grain: SitemapGrain; readonly key: string }): Date {
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
  readonly grain: SitemapGrain;
  readonly date: Date;
  readonly delta: number;
}): Date {
  const next = new Date(date.getTime());
  if (grain === "day") next.setUTCDate(next.getUTCDate() + delta);
  else if (grain === "month") next.setUTCMonth(next.getUTCMonth() + delta);
  else next.setUTCFullYear(next.getUTCFullYear() + delta);
  return next;
}
