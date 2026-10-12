import { getRequestEvent, query } from "$app/server";
import { dimensions, grains } from "@beesolve/analytics-processor";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

const getBreakdownSchema = v.object({
  dimension: v.picklist(dimensions),
  grain: v.picklist(grains),
  periodKey: v.string(),
});

export const getBreakdown = query(getBreakdownSchema, async ({ dimension, grain, periodKey }) => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);

    const items = await locals.services.breakdowns.getForPeriod({ dimension, grain, periodKey });

    return {
      dimension,
      grain,
      periodKey,
      items: items
        .map((item) => ({ value: item.value, hits: item.hits, bytes: item.bytes }))
        .sort((left, right) => right.hits - left.hits),
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});
