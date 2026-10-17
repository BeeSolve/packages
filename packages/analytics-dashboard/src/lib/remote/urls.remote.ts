import { form, getRequestEvent, query } from "$app/server";
import { error } from "@sveltejs/kit";
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

export const listUrls = query(async () => {
  const { locals } = getRequestEvent();
  try {
    requireUser(locals.user);
    const entries = await locals.services.urls.listUrls();
    const items = [...entries].sort((left, right) => left.url.localeCompare(right.url));
    return { items };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const addToWatchlistSchema = v.object({
  url: v.pipe(v.string(), v.nonEmpty("Please provide a URL.")),
});

export const addToWatchlist = form(addToWatchlistSchema, async ({ url }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

  try {
    await locals.services.analyticsClient.upsertWatch({
      matcher: url,
      mode: "exact",
      source: "manual",
      status: "active",
    });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  return { ok: true };
});
