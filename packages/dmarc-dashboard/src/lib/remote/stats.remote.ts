import { getRequestEvent, query } from "$app/server";
import { error } from "@sveltejs/kit";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

export const listStats = query(async () => {
  const { locals } = getRequestEvent();
  const { services, user } = locals;
  try {
    const currentUser = requireUser(user);
    if (currentUser.type !== "admin") {
      error(403, "Access denied — admin only");
    }

    const today = new Date();
    const endDate = today.toISOString().slice(0, 10);

    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - 29);
    const startDateStr = startDate.toISOString().slice(0, 10);

    const stats = await services.stats.queryRange({
      startDate: startDateStr,
      endDate,
    });

    const totals = stats.reduce(
      (acc, day) => ({
        processed: acc.processed + day.processed,
        manualUpload: acc.manualUpload + day.manualUpload,
        authRejected: acc.authRejected + day.authRejected,
        spamRejected: acc.spamRejected + day.spamRejected,
        virusRejected: acc.virusRejected + day.virusRejected,
      }),
      { processed: 0, manualUpload: 0, authRejected: 0, spamRejected: 0, virusRejected: 0 },
    );

    const totalRejected = totals.authRejected + totals.spamRejected + totals.virusRejected;

    return {
      stats: stats.map((day) => ({
        date: day.sk,
        processed: day.processed,
        manualUpload: day.manualUpload,
        authRejected: day.authRejected,
        spamRejected: day.spamRejected,
        virusRejected: day.virusRejected,
        totalRejected: day.authRejected + day.spamRejected + day.virusRejected,
      })),
      totals: { ...totals, totalRejected },
      dateRange: { startDate: startDateStr, endDate },
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});
