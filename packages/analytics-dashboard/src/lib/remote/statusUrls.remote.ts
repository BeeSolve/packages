import { getRequestEvent, query } from "$app/server";
import type { Grain, WatchStatsRecord } from "@beesolve/analytics-processor";
import { grains } from "@beesolve/analytics-processor";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";
import type { WatchGrain } from "#lib/watchWindow.js";
import { monthSpanForPeriod, scalarsForPeriod } from "#lib/watchWindow.js";

const periodKeySchema = v.pipe(
  v.string(),
  v.regex(/^\d{4}(-\d{2}){0,2}$/, "Expected a YYYY, YYYY-MM or YYYY-MM-DD period key"),
);

const getStatusUrlsSchema = v.object({
  grain: v.picklist(grains),
  periodKey: periodKeySchema,
});

interface StatusUrlRow {
  readonly pk: string;
  readonly matcher: string;
  readonly label: string;
  readonly errors: number;
  readonly redirects: number;
}

/**
 * Watch buckets that saw client/server errors (4xx+5xx) or redirects (3xx)
 * during the period. Reads the monthly watch records spanning the period from
 * the reverse index and keeps only buckets with a non-zero error or redirect
 * count. Status class only — no exact per-URL codes are available here.
 */
export const getStatusUrls = query(getStatusUrlsSchema, async ({ grain, periodKey }) => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);

    const watchGrain = toWatchGrain(grain);
    const { startMonth, endMonth } = monthSpanForPeriod({ grain: watchGrain, periodKey });
    const months = monthsBetween({ startMonth, endMonth });
    const perMonth = await Promise.all(
      months.map((month) => locals.services.watchStats.getForMonth({ month })),
    );
    const records = perMonth.flat();

    const byBucket: Record<string, Array<WatchStatsRecord>> = {};
    for (const record of records) {
      (byBucket[record.pk] ??= []).push(record);
    }

    const rows: Array<StatusUrlRow> = [];
    for (const [pk, bucketRecords] of Object.entries(byBucket)) {
      const first = bucketRecords[0];
      const matcher = first?.matcher ?? pk;
      const scalars = scalarsForPeriod({ grain: watchGrain, periodKey, records: bucketRecords });
      if (scalars.errors === 0 && scalars.redirects === 0) continue;
      rows.push({
        pk,
        matcher,
        label: labelForPk({ pk, matcher }),
        errors: scalars.errors,
        redirects: scalars.redirects,
      });
    }

    rows.sort(
      (left, right) =>
        right.errors + right.redirects - (left.errors + left.redirects) ||
        left.label.localeCompare(right.label),
    );

    return { grain, periodKey, items: rows };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

function labelForPk({ pk, matcher }: { readonly pk: string; readonly matcher: string }): string {
  const prefix = `watch#${matcher}#`;
  if (pk.startsWith(prefix)) return pk.slice(prefix.length);
  return matcher;
}

function toWatchGrain(grain: Grain): WatchGrain {
  if (grain === "month") return "month";
  return "day";
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
