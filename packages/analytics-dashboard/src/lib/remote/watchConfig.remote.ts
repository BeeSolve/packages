import { form, getRequestEvent, query } from "$app/server";
import type { WatchMode } from "@beesolve/analytics-processor";
import { error, invalid, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";

function requireAdmin(): NonNullable<App.Locals["user"]> {
  const { locals } = getRequestEvent();
  const currentUser = requireUser(locals.user);
  if (currentUser.type !== "admin") {
    error(403, "Access denied");
  }
  return currentUser;
}

export const getSitemapConfig = query(async () => {
  const { locals } = getRequestEvent();
  try {
    requireAdmin();
    const sitemapConfig = await locals.services.config.getSitemapConfig();
    return {
      sitemapUrl: sitemapConfig.sitemapUrl,
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const setSitemapUrlSchema = v.object({
  sitemapUrl: v.pipe(v.string(), v.url("Please enter a valid sitemap URL.")),
});

export const setSitemapUrl = form(setSitemapUrlSchema, async ({ sitemapUrl }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

  try {
    await locals.services.analyticsClient.updateSitemapUrl({ sitemapUrl });
    await locals.services.analyticsClient.syncSitemapNow();
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await getSitemapConfig().refresh();
  await listWatchConfig().refresh();

  redirect(303, "/settings");
});

export const listWatchConfig = query(async () => {
  const { locals } = getRequestEvent();
  try {
    requireAdmin();
    const entries = await locals.services.config.listWatch();
    const items = [...entries].sort((left, right) => left.matcher.localeCompare(right.matcher));
    return { items };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

/**
 * Parse the `*`/`+` matcher sugar into a structured `{ matcher, mode }`. A
 * trailing `*` means split (each path under the prefix is its own bucket), a
 * trailing `+` means group (one collapsed bucket), anything else is an exact
 * single URL. The slash before the suffix is optional, so `/blog*` and
 * `/blog/*` are both accepted (and stored as the prefix with the suffix
 * stripped, `/blog` and `/blog/` respectively). The matcher or prefix must
 * start with `/`.
 */
function parsePattern(pattern: string): { matcher: string; mode: WatchMode } {
  const trimmed = pattern.trim();
  if (trimmed.endsWith("*")) {
    return { matcher: trimmed.slice(0, -1), mode: "split" };
  }
  if (trimmed.endsWith("+")) {
    return { matcher: trimmed.slice(0, -1), mode: "group" };
  }
  return { matcher: trimmed, mode: "exact" };
}

const addWatchSchema = v.object({
  pattern: v.pipe(v.string(), v.nonEmpty("Please enter a pattern.")),
});

export const addWatch = form(addWatchSchema, async ({ pattern }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

  const { matcher, mode } = parsePattern(pattern);
  if (!matcher.startsWith("/")) {
    invalid("Pattern must start with '/'.");
  }

  try {
    await locals.services.analyticsClient.upsertWatch({
      matcher,
      mode,
      source: "manual",
      status: "active",
    });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await listWatchConfig().refresh();

  return { ok: true };
});

const setWatchStatusSchema = v.object({
  matcher: v.pipe(v.string(), v.nonEmpty()),
  status: v.picklist(["active", "stopped"] as const),
});

export const setWatchStatus = form(setWatchStatusSchema, async ({ matcher, status }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

  try {
    await locals.services.analyticsClient.setWatchStatus({ matcher, status });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await listWatchConfig().refresh();

  return { ok: true };
});

const deleteWatchSchema = v.object({
  matcher: v.pipe(v.string(), v.nonEmpty()),
});

export const deleteWatch = form(deleteWatchSchema, async ({ matcher }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

  try {
    await locals.services.analyticsClient.deleteWatch({ matcher });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await listWatchConfig().refresh();

  return { ok: true };
});
