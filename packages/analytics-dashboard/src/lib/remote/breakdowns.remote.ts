import { getRequestEvent, query } from "$app/server";
import { dimensions, grains, resolveBreakdownLive, tiers } from "@beesolve/analytics-processor";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

const getBreakdownSchema = v.object({
  dimension: v.picklist(dimensions),
  grain: v.picklist(grains),
  periodKey: v.string(),
  tier: v.optional(v.picklist(tiers), "all"),
});

export const getBreakdown = query(
  getBreakdownSchema,
  async ({ dimension, grain, periodKey, tier }) => {
    const { locals } = getRequestEvent();
    try {
      requireUser(locals.user);

      const items = await resolveBreakdownLive({
        models: {
          totals: locals.services.totals,
          breakdowns: locals.services.breakdowns,
          markers: locals.services.markers,
        },
        dimension,
        grain,
        periodKey,
        tier,
        now: new Date(),
      });

      return {
        dimension,
        grain,
        periodKey,
        tier,
        items: items
          .map((item) => ({ value: item.value, hits: item.hits, bytes: item.bytes }))
          .sort((left, right) => right.hits - left.hits),
      };
    } catch (thrown) {
      toRemoteError(thrown, { redirectOnUnauthorized: true });
    }
  },
);
