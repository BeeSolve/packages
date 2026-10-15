import { getRequestEvent, query } from "$app/server";
import type { SitemapUrlStatRecord } from "@beesolve/analytics-processor";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";
import {
  defaultWindowSize,
  hitsForPeriod,
  monthSpanForPeriod,
  monthSpanForWindow,
  sitemapGrains,
  trendBucketKeys,
} from "#lib/sitemapWindow.js";

const periodKeySchema = v.pipe(
  v.string(),
  v.regex(/^\d{4}(-\d{2}){0,2}$/, "Expected a YYYY, YYYY-MM or YYYY-MM-DD period key"),
);

const getSitemapPeriodSchema = v.object({
  grain: v.picklist(sitemapGrains),
  periodKey: periodKeySchema,
});

/**
 * Ranked per-path hits for a single period (day, month or year). Reads the
 * monthly sitemap items spanning the period from the reverse index and projects
 * each path to its hits at the chosen grain.
 */
export const getSitemapPeriod = query(getSitemapPeriodSchema, async ({ grain, periodKey }) => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);

    const { startMonth, endMonth } = monthSpanForPeriod({ grain, periodKey });
    const records = await monthlyRecords({
      services: locals.services,
      startMonth,
      endMonth,
    });

    const byPath: Record<string, Array<SitemapUrlStatRecord>> = {};
    for (const record of records) {
      (byPath[record.path] ??= []).push(record);
    }

    const items = Object.entries(byPath)
      .map(([path, pathRecords]) => ({
        path,
        hits: hitsForPeriod({ grain, periodKey, records: pathRecords }),
      }))
      .filter((item) => item.hits > 0)
      .sort((left, right) => right.hits - left.hits || left.path.localeCompare(right.path));

    return { grain, periodKey, items };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const getSitemapTrendSchema = v.object({
  path: v.string(),
  grain: v.picklist(sitemapGrains),
  anchorKey: periodKeySchema,
  size: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120))),
});

/**
 * Hit trend for a single path across a window of `size` periods ending at
 * `anchorKey`. One reverse-free ranged read of the path's monthly items backs
 * every bucket, which are then projected per grain in memory.
 */
export const getSitemapTrend = query(
  getSitemapTrendSchema,
  async ({ path, grain, anchorKey, size }) => {
    const { locals } = getRequestEvent();
    try {
      requireUser(locals.user);

      const windowSize = size ?? defaultWindowSize(grain);
      const bucketKeys = trendBucketKeys({ grain, anchorKey, size: windowSize });
      const { startMonth, endMonth } = monthSpanForWindow({ grain, bucketKeys });

      const records = await locals.services.sitemapUrlStats.getForUrl({
        path,
        startMonth,
        endMonth,
      });

      const buckets = bucketKeys.map((key) => ({
        key,
        hits: hitsForPeriod({ grain, periodKey: key, records }),
      }));

      return { path, grain, anchorKey, size: windowSize, buckets };
    } catch (thrown) {
      toRemoteError(thrown, { redirectOnUnauthorized: true });
    }
  },
);

async function monthlyRecords({
  services,
  startMonth,
  endMonth,
}: {
  readonly services: App.Locals["services"];
  readonly startMonth: string;
  readonly endMonth: string;
}): Promise<Array<SitemapUrlStatRecord>> {
  const months = monthsBetween({ startMonth, endMonth });
  const perMonth = await Promise.all(
    months.map((month) => services.sitemapUrlStats.getForMonth({ month })),
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
