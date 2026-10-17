import { getRequestEvent, query } from "$app/server";
import type { WatchEntryRecord, WatchMode, WatchStatsRecord } from "@beesolve/analytics-processor";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";
import {
  defaultWindowSize,
  hitsForPeriod,
  monthSpanForPeriod,
  monthSpanForWindow,
  scalarsForPeriod,
  trendBucketKeys,
  watchGrains,
} from "#lib/watchWindow.js";

const periodKeySchema = v.pipe(
  v.string(),
  v.regex(/^\d{4}(-\d{2}){0,2}$/, "Expected a YYYY, YYYY-MM or YYYY-MM-DD period key"),
);

const watchModeSchema = v.picklist(["exact", "split", "group"] as const);

const getWatchPeriodSchema = v.object({
  grain: v.picklist(watchGrains),
  periodKey: periodKeySchema,
});

interface RankedBucket {
  readonly pk: string;
  readonly matcher: string;
  readonly mode: WatchMode;
  readonly label: string;
  readonly source: WatchEntryRecord["source"] | null;
  readonly status: WatchEntryRecord["status"];
  readonly hits: number;
  readonly bytesSent: number;
  readonly bytesSaved: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
}

/**
 * Ranked watch buckets for a single period (day, month or year). Reads the
 * monthly watch records spanning the period from the reverse index, groups them
 * by bucket (`pk`), and joins against the watch config so `stopped` entries with
 * no metrics this period still appear with their status/source. Hits are taken
 * at the chosen grain; the non-hits columns (bytes, cache counts, bytes saved)
 * are month-level scalars projected to the containing month(s) of the period.
 */
export const getWatchPeriod = query(getWatchPeriodSchema, async ({ grain, periodKey }) => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);

    const { startMonth, endMonth } = monthSpanForPeriod({ grain, periodKey });
    const [records, entries] = await Promise.all([
      monthlyRecords({ services: locals.services, startMonth, endMonth }),
      locals.services.config.listWatch(),
    ]);

    const entryByMatcher: Record<string, WatchEntryRecord> = {};
    for (const entry of entries) {
      entryByMatcher[entry.matcher] = entry;
    }

    const byBucket: Record<string, Array<WatchStatsRecord>> = {};
    for (const record of records) {
      (byBucket[record.pk] ??= []).push(record);
    }

    const buckets: Array<RankedBucket> = Object.entries(byBucket).map(([pk, bucketRecords]) => {
      const first = bucketRecords[0];
      const matcher = first?.matcher ?? pk;
      const mode = first?.mode ?? "exact";
      const entry = entryByMatcher[matcher];
      const scalars = scalarsForPeriod({ grain, periodKey, records: bucketRecords });
      return {
        pk,
        matcher,
        mode,
        label: bucketLabel({ pk, matcher, mode }),
        source: entry?.source ?? null,
        status: entry?.status ?? "stopped",
        hits: hitsForPeriod({ grain, periodKey, records: bucketRecords }),
        bytesSent: scalars.bytesSent,
        bytesSaved: scalars.bytesSaved,
        cacheHits: scalars.cacheHits,
        cacheMisses: scalars.cacheMisses,
        cacheErrors: scalars.cacheErrors,
      };
    });

    for (const entry of entries) {
      const pk = `watch#${entry.matcher}`;
      if (entry.mode !== "split" && byBucket[pk] == null) {
        buckets.push({
          pk,
          matcher: entry.matcher,
          mode: entry.mode,
          label: bucketLabel({ pk, matcher: entry.matcher, mode: entry.mode }),
          source: entry.source,
          status: entry.status,
          hits: 0,
          bytesSent: 0,
          bytesSaved: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheErrors: 0,
        });
      }
    }

    buckets.sort((left, right) => right.hits - left.hits || left.label.localeCompare(right.label));

    return { grain, periodKey, items: buckets };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const getWatchTrendSchema = v.object({
  pk: v.string(),
  matcher: v.string(),
  mode: watchModeSchema,
  grain: v.picklist(watchGrains),
  anchorKey: periodKeySchema,
  size: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120))),
});

/**
 * Hit trend for a single watch bucket across a window of `size` periods ending
 * at `anchorKey`. One ranged read of the bucket's monthly records backs every
 * bucket, which are then projected per grain in memory.
 */
export const getWatchTrend = query(
  getWatchTrendSchema,
  async ({ pk, matcher, mode, grain, anchorKey, size }) => {
    const { locals } = getRequestEvent();
    try {
      requireUser(locals.user);

      const windowSize = size ?? defaultWindowSize(grain);
      const bucketKeys = trendBucketKeys({ grain, anchorKey, size: windowSize });
      const { startMonth, endMonth } = monthSpanForWindow({ grain, bucketKeys });

      const records = await locals.services.watchStats.getForEntry({
        matcher,
        mode,
        path: pathFromPk({ pk, matcher, mode }),
        startMonth,
        endMonth,
      });

      const buckets = bucketKeys.map((key) => ({
        key,
        hits: hitsForPeriod({ grain, periodKey: key, records }),
      }));

      return { pk, matcher, mode, grain, anchorKey, size: windowSize, buckets };
    } catch (thrown) {
      toRemoteError(thrown, { redirectOnUnauthorized: true });
    }
  },
);

function pathFromPk({
  pk,
  matcher,
  mode,
}: {
  readonly pk: string;
  readonly matcher: string;
  readonly mode: WatchMode;
}): string | undefined {
  if (mode !== "split") return undefined;
  const prefix = `watch#${matcher}#`;
  return pk.startsWith(prefix) ? pk.slice(prefix.length) : undefined;
}

function bucketLabel({
  pk,
  matcher,
  mode,
}: {
  readonly pk: string;
  readonly matcher: string;
  readonly mode: WatchMode;
}): string {
  if (mode !== "split") return matcher;
  const path = pathFromPk({ pk, matcher, mode });
  return path ?? matcher;
}

async function monthlyRecords({
  services,
  startMonth,
  endMonth,
}: {
  readonly services: App.Locals["services"];
  readonly startMonth: string;
  readonly endMonth: string;
}): Promise<Array<WatchStatsRecord>> {
  const months = monthsBetween({ startMonth, endMonth });
  const perMonth = await Promise.all(
    months.map((month) => services.watchStats.getForMonth({ month })),
  );
  return perMonth.flat();
}

function monthsBetween({
  startMonth,
  endMonth,
}: {
  readonly startMonth: string;
  readonly endMonth: string;
}): Array<string> {
  const months: Array<string> = [];
  let year = Number(startMonth.slice(0, 4));
  let month = Number(startMonth.slice(5, 7));
  const endYear = Number(endMonth.slice(0, 4));
  const endMonthNumber = Number(endMonth.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonthNumber)) {
    months.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
