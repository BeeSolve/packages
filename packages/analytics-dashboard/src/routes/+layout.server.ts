import { ANALYTICS_HOURLY_TTL_DAYS, ANALYTICS_PROCESSING_LAG_HOURS } from "$app/env/private";
import { hourKey } from "@beesolve/analytics-processor";

import type { LayoutServerLoad } from "./$types.js";

export const load: LayoutServerLoad = async ({ locals }) => {
  const config = await locals.services.config.get();
  const startKey = config?.startKey ?? hourKey(new Date());

  return {
    user: locals.user,
    startKey,
    processingLagHours: Number(ANALYTICS_PROCESSING_LAG_HOURS),
    hourlyRetentionDays: Number(ANALYTICS_HOURLY_TTL_DAYS),
  };
};
