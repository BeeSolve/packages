import type { Grain, TotalsItem } from "@beesolve/analytics-processor";
import {
  dayKey,
  hourKey,
  maxWindowFor,
  monthKey,
  shiftAnchor,
  windowKeys,
} from "@beesolve/analytics-processor";

export const yearViewMaxMonths = 120;

export interface ResolvedWindow {
  readonly grain: Grain;
  readonly size: number;
  readonly startKey: string;
  readonly endKey: string;
  readonly prevAnchor: string;
  readonly nextAnchor: string;
  readonly bucketKeys: Array<string>;
}

export function clampSize({
  grain,
  size,
  years,
}: {
  readonly grain: Grain;
  readonly size: number | undefined;
  readonly years: boolean;
}): number {
  const max = years ? yearViewMaxMonths : maxWindowFor(grain);
  if (size == null || !Number.isFinite(size)) return max;
  const floored = Math.floor(size);
  if (floored < 1) return 1;
  if (floored > max) return max;
  return floored;
}

export function resolveWindow({
  grain,
  anchor,
  size,
  years = false,
}: {
  readonly grain: Grain;
  readonly anchor: Date;
  readonly size?: number;
  readonly years?: boolean;
}): ResolvedWindow {
  const effectiveGrain: Grain = years ? "month" : grain;
  const clamped = clampSize({ grain: effectiveGrain, size, years });
  const { startKey, endKey } = windowKeys({ grain: effectiveGrain, anchor, size: clamped });

  return {
    grain: effectiveGrain,
    size: clamped,
    startKey,
    endKey,
    prevAnchor: shiftAnchor({
      grain: effectiveGrain,
      anchor,
      size: clamped,
      direction: "prev",
    }).toISOString(),
    nextAnchor: shiftAnchor({
      grain: effectiveGrain,
      anchor,
      size: clamped,
      direction: "next",
    }).toISOString(),
    bucketKeys: enumerateBuckets({ grain: effectiveGrain, anchor, size: clamped }),
  };
}

export function enumerateBuckets({
  grain,
  anchor,
  size,
}: {
  readonly grain: Grain;
  readonly anchor: Date;
  readonly size: number;
}): Array<string> {
  const keys: Array<string> = [];
  for (let offset = size - 1; offset >= 0; offset -= 1) {
    const bucketDate = shiftAnchor({ grain, anchor, size: offset, direction: "prev" });
    keys.push(keyFor(grain, bucketDate));
  }
  return keys;
}

export function zeroFillSeries({
  bucketKeys,
  grain,
  items,
}: {
  readonly bucketKeys: Array<string>;
  readonly grain: Grain;
  readonly items: Array<TotalsItem>;
}): Array<TotalsItem> {
  const byKey: Record<string, TotalsItem> = {};
  for (const item of items) {
    byKey[item.timeKey] = item;
  }

  return bucketKeys.map((bucketKey) => byKey[bucketKey] ?? emptyTotalsItem({ grain, bucketKey }));
}

export interface YearBucket {
  readonly year: string;
  readonly hits: number;
  readonly success: number;
  readonly errors: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
}

export function groupMonthlyByYear(items: Array<TotalsItem>): Array<YearBucket> {
  const byYear: Record<string, YearBucket> = {};

  for (const item of items) {
    const year = item.timeKey.slice(0, 4);
    const existing = byYear[year];
    if (existing == null) {
      byYear[year] = {
        year,
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
      continue;
    }

    byYear[year] = {
      year,
      hits: existing.hits + item.hits,
      success: existing.success + item.success,
      errors: existing.errors + item.errors,
      errors4xx: existing.errors4xx + item.errors4xx,
      errors5xx: existing.errors5xx + item.errors5xx,
      bytesSent: existing.bytesSent + item.bytesSent,
      bytesReceived: existing.bytesReceived + item.bytesReceived,
      cacheHits: existing.cacheHits + item.cacheHits,
      cacheMisses: existing.cacheMisses + item.cacheMisses,
      cacheErrors: existing.cacheErrors + item.cacheErrors,
    };
  }

  return Object.values(byYear).sort((left, right) => left.year.localeCompare(right.year));
}

function keyFor(grain: Grain, date: Date): string {
  if (grain === "hour") return hourKey(date);
  if (grain === "day") return dayKey(date);
  return monthKey(date);
}

function emptyTotalsItem({
  grain,
  bucketKey,
}: {
  readonly grain: Grain;
  readonly bucketKey: string;
}): TotalsItem {
  return {
    pk: `totals#${grain}`,
    sk: bucketKey,
    grain,
    timeKey: bucketKey,
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
}
