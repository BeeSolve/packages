import { getRequestEvent, query } from "$app/server";
import type { TotalsItem } from "@beesolve/analytics-processor";
import { grains } from "@beesolve/analytics-processor";
import * as v from "valibot";

import type { YearBucket } from "#lib/overviewWindow.js";
import { groupMonthlyByYear, resolveWindow, zeroFillSeries } from "#lib/overviewWindow.js";
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

    const anchorDate = anchor != null ? new Date(anchor) : new Date();
    const resolved = resolveWindow({ grain, anchor: anchorDate, size, years: years ?? false });

    const items = await locals.services.totals.queryWindow({
      grain: resolved.grain,
      startKey: resolved.startKey,
      endKey: resolved.endKey,
    });

    const series: Array<TotalsItem> = zeroFillSeries({
      bucketKeys: resolved.bucketKeys,
      grain: resolved.grain,
      items,
    });

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
