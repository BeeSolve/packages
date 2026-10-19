import { columnMap } from "./athena.ts";
import type { Tier } from "./keys.ts";
import { canonicalUriExpr, escapeSqlString } from "./sql.ts";
import type { WatchEntry } from "./watch.ts";

/**
 * The `real` tier predicate: browser-served HTML page views. Matches
 * `text/html` (and the `text/html;charset=…` variant, hence `LIKE`) with a
 * `2xx` status only. `3xx` is excluded deliberately - a redirect is not a page
 * view, and the legacy 404->index rewrite logged large volumes of `text/html`
 * `3xx`. See ADR-010.
 */
export const realTierPredicate = `${columnMap.contentType} LIKE 'text/html%' AND ${columnMap.status} BETWEEN 200 AND 299`;

/**
 * The `watch` tier predicate: a flat `IN` list over the slash-collapsed URI of
 * the active `source="sitemap"` watch entries - the site's own declaration of
 * its real pages. Returns `undefined` when the set is empty so the caller can
 * no-op (write nothing, run no query) instead of scanning the full partition.
 */
export function watchTierPredicate(entries: ReadonlyArray<WatchEntry>): string | undefined {
  const paths = sitemapPaths(entries);
  if (paths.length === 0) return undefined;

  const canonicalUri = canonicalUriExpr(columnMap.uriStem);
  const inList = paths.map((path) => `'${escapeSqlString(path)}'`).join(", ");
  return `${canonicalUri} IN (${inList})`;
}

/**
 * The active sitemap matchers from a watch-entry list, de-duplicated and sorted
 * for a stable query string. Only `source="sitemap"` + `status="active"` count.
 */
export function sitemapPaths(entries: ReadonlyArray<WatchEntry>): Array<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.source === "sitemap" && entry.status === "active") {
      seen.add(entry.matcher);
    }
  }
  return Array.from(seen).sort();
}

/**
 * The extra WHERE predicate for a tier, or `undefined` for a tier that scans
 * every row (`all`) or has an empty set (`watch` with no active sitemap).
 */
export function tierPredicate({
  tier,
  sitemapEntries,
}: {
  tier: Tier;
  sitemapEntries: ReadonlyArray<WatchEntry>;
}): string | undefined {
  if (tier === "all") return undefined;
  if (tier === "real") return realTierPredicate;
  return watchTierPredicate(sitemapEntries);
}
