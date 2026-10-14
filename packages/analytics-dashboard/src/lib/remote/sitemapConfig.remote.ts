import { form, getRequestEvent, query } from "$app/server";
import { error, redirect } from "@sveltejs/kit";
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
    await locals.services.config.setSitemapUrl({ sitemapUrl });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await getSitemapConfig().refresh();

  redirect(303, "/settings");
});
