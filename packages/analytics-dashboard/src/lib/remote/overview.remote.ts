import { getRequestEvent, query } from "$app/server";
import type { Grain, SummedTotals, TotalsItem } from "@beesolve/analytics-processor";
import { grains, resolveTotalsLive } from "@beesolve/analytics-processor";
import * as v from "valibot";

import type { YearBucket } from "#lib/overviewWindow.js";
import { groupMonthlyByYear, resolveWindow } from "#lib/overviewWindow.js";
import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

const getOverviewSchema = v.object({
  grain: v.picklist(grains),
  anchor: v.optional(v.pipe(v.string(), v.isoTimestamp())),
  size: v.optional(v.number()),
  years: v.optional(v.boolean()),
});

export const getOverview = query(getOverviewSchema, async ({ grain, anchor, size, years }) => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);

    const now = new Date();
    const anchorDate = anchor != null ? new Date(anchor) : now;
    const resolved = resolveWindow({ grain, anchor: anchorDate, size, years: years ?? false });

    const stored = await locals.services.totals.queryWindow({
      grain: resolved.grain,
      startKey: resolved.startKey,
      endKey: resolved.endKey,
    });
    const storedByKey: Record<string, TotalsItem> = {};
    for (const item of stored) {
      storedByKey[item.timeKey] = item;
    }

    const series = await Promise.all(
      resolved.bucketKeys.map((bucketKey) =>
        resolveSeriesBucket({
          services: locals.services,
          grain: resolved.grain,
          bucketKey,
          stored: storedByKey[bucketKey],
          now,
        }),
      ),
    );

    const yearSeries: Array<YearBucket> | null = years === true ? groupMonthlyByYear(series) : null;

    return {
      grain: resolved.grain,
      size: resolved.size,
      years: years === true,
      startKey: resolved.startKey,
      endKey: resolved.endKey,
      prevAnchor: resolved.prevAnchor,
      nextAnchor: resolved.nextAnchor,
      series,
      yearSeries,
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

async function resolveSeriesBucket({
  services,
  grain,
  bucketKey,
  stored,
  now,
}: {
  readonly services: App.Locals["services"];
  readonly grain: Grain;
  readonly bucketKey: string;
  readonly stored: TotalsItem | undefined;
  readonly now: Date;
}): Promise<TotalsItem> {
  if (stored != null) return stored;

  const live = await resolveTotalsLive({
    models: {
      totals: services.totals,
      breakdowns: services.breakdowns,
      markers: services.markers,
    },
    grain,
    periodKey: bucketKey,
    now,
  });
  return toTotalsItem({ grain, bucketKey, totals: live });
}

function toTotalsItem({
  grain,
  bucketKey,
  totals,
}: {
  readonly grain: Grain;
  readonly bucketKey: string;
  readonly totals: SummedTotals;
}): TotalsItem {
  return {
    pk: `totals#${grain}`,
    sk: bucketKey,
    grain,
    timeKey: bucketKey,
    hits: totals.hits,
    success: totals.success,
    errors: totals.errors,
    errors4xx: totals.errors4xx,
    errors5xx: totals.errors5xx,
    bytesSent: totals.bytesSent,
    bytesReceived: totals.bytesReceived,
  };
}
