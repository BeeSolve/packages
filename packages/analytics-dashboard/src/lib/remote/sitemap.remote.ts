import { getRequestEvent, query } from "$app/server";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

const monthKeySchema = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/, "Expected a YYYY-MM month key"));

const getSitemapComparisonSchema = v.object({
  monthA: monthKeySchema,
  monthB: monthKeySchema,
});

export const getSitemapComparison = query(
  getSitemapComparisonSchema,
  async ({ monthA, monthB }) => {
    const { locals } = getRequestEvent();
    try {
      requireUser(locals.user);

      const [recordsA, recordsB] = await Promise.all([
        locals.services.sitemapUrlStats.getForMonth({ month: monthA }),
        locals.services.sitemapUrlStats.getForMonth({ month: monthB }),
      ]);

      const hitsByPath: Record<string, { hitsA: number; hitsB: number }> = {};

      for (const record of recordsA) {
        const existing = hitsByPath[record.path] ?? { hitsA: 0, hitsB: 0 };
        existing.hitsA = record.hits;
        hitsByPath[record.path] = existing;
      }

      for (const record of recordsB) {
        const existing = hitsByPath[record.path] ?? { hitsA: 0, hitsB: 0 };
        existing.hitsB = record.hits;
        hitsByPath[record.path] = existing;
      }

      const items = Object.entries(hitsByPath)
        .map(([path, counts]) => ({
          path,
          hitsA: counts.hitsA,
          hitsB: counts.hitsB,
          delta: counts.hitsB - counts.hitsA,
        }))
        .sort((left, right) => right.hitsB - left.hitsB || right.hitsA - left.hitsA);

      return { monthA, monthB, items };
    } catch (thrown) {
      toRemoteError(thrown, { redirectOnUnauthorized: true });
    }
  },
);

const getSitemapUrlSchema = v.object({
  path: v.string(),
  startMonth: monthKeySchema,
  endMonth: monthKeySchema,
});

export const getSitemapUrl = query(getSitemapUrlSchema, async ({ path, startMonth, endMonth }) => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);

    const records = await locals.services.sitemapUrlStats.getForUrl({
      path,
      startMonth,
      endMonth,
    });

    const months = records.map((record) => ({
      month: record.month,
      hits: record.hits,
      days: record.days,
      dayCounts: Object.entries(record.days)
        .map(([day, hits]) => ({ day, hits }))
        .sort((left, right) => left.day.localeCompare(right.day)),
    }));

    return { path, months };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});
