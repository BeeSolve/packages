import { getRequestEvent, query } from "$app/server";
import type {
  BucketState,
  Grain,
  SummedTotals,
  Tier,
  TotalsItem,
} from "@beesolve/analytics-processor";
import {
  classifyBucketState,
  grains,
  resolveTotalsLive,
  tiers,
  tierSegment,
} from "@beesolve/analytics-processor";
import * as v from "valibot";

import type { YearBucket } from "#lib/overviewWindow.js";
import { groupMonthlyByYear, resolveWindow } from "#lib/overviewWindow.js";
import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

export interface OverviewBucket extends TotalsItem {
  readonly state: BucketState;
}

export interface YearSeriesBucket extends YearBucket {
  readonly state: BucketState;
}

const getOverviewSchema = v.object({
  grain: v.picklist(grains),
  anchor: v.optional(v.pipe(v.string(), v.isoTimestamp())),
  size: v.optional(v.number()),
  years: v.optional(v.boolean()),
  tier: v.optional(v.picklist(tiers), "all"),
});

export const getOverview = query(
  getOverviewSchema,
  async ({ grain, anchor, size, years, tier }) => {
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
        tier,
      });
      const storedByKey: Record<string, TotalsItem> = {};
      for (const item of stored) {
        storedByKey[item.timeKey] = item;
      }

      const series: Array<OverviewBucket> = await Promise.all(
        resolved.bucketKeys.map((bucketKey) =>
          resolveSeriesBucket({
            services: locals.services,
            grain: resolved.grain,
            bucketKey,
            stored: storedByKey[bucketKey],
            now,
            tier,
          }),
        ),
      );

      const yearSeries: Array<YearSeriesBucket> | null =
        years === true ? toYearSeries(series) : null;

      return {
        grain: resolved.grain,
        size: resolved.size,
        years: years === true,
        tier,
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
  },
);

async function resolveSeriesBucket({
  services,
  grain,
  bucketKey,
  stored,
  now,
  tier,
}: {
  readonly services: App.Locals["services"];
  readonly grain: Grain;
  readonly bucketKey: string;
  readonly stored: TotalsItem | undefined;
  readonly now: Date;
  readonly tier: Tier;
}): Promise<OverviewBucket> {
  const models = {
    totals: services.totals,
    breakdowns: services.breakdowns,
    markers: services.markers,
  };

  if (stored != null) {
    const state = await classifyBucketState({
      models,
      grain,
      periodKey: bucketKey,
      now,
      hasData: true,
      tier,
    });
    return { ...stored, state };
  }

  const live = await resolveTotalsLive({ models, grain, periodKey: bucketKey, now, tier });
  const hasData = live.hits > 0;
  const state = await classifyBucketState({
    models,
    grain,
    periodKey: bucketKey,
    now,
    hasData,
    tier,
  });
  return { ...toTotalsItem({ grain, bucketKey, totals: live, tier }), state };
}

function toYearSeries(series: Array<OverviewBucket>): Array<YearSeriesBucket> {
  const totalsByYear = groupMonthlyByYear(series);
  const statesByYear: Record<string, Array<BucketState>> = {};
  for (const bucket of series) {
    const year = bucket.timeKey.slice(0, 4);
    (statesByYear[year] ??= []).push(bucket.state);
  }

  return totalsByYear.map((yearBucket) => ({
    ...yearBucket,
    state: rollUpState(statesByYear[yearBucket.year] ?? []),
  }));
}

// A grouped period is sealed only when every child is sealed; partial if any
// child is partial (data present but not final); otherwise pending.
function rollUpState(states: Array<BucketState>): BucketState {
  if (states.length > 0 && states.every((state) => state === "sealed")) return "sealed";
  if (states.includes("partial")) return "partial";
  return "pending";
}

function toTotalsItem({
  grain,
  bucketKey,
  totals,
  tier,
}: {
  readonly grain: Grain;
  readonly bucketKey: string;
  readonly totals: SummedTotals;
  readonly tier: Tier;
}): TotalsItem {
  return {
    pk: `totals${tierSegment(tier)}#${grain}`,
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
    cacheHits: totals.cacheHits,
    cacheMisses: totals.cacheMisses,
    cacheErrors: totals.cacheErrors,
  };
}
