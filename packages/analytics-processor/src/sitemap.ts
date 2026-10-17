/**
 * Collapse a single trailing slash on a path so `/blog/` and `/blog` fold
 * together. Root `/` is preserved. Already-unslashed paths are returned as-is.
 */
export function canonicalPath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Parse an absolute sitemap `<loc>` URL and reduce it to a canonical path:
 * origin, query and fragment are stripped and a trailing slash is collapsed.
 * Throws on input the `URL` class cannot parse.
 */
export function normalizeSitemapLoc(loc: string): string {
  let parsed: URL;
  try {
    parsed = new URL(loc);
  } catch {
    throw new Error(`Unparseable sitemap <loc>: ${loc}`);
  }
  return canonicalPath(parsed.pathname);
}

/**
 * Extract every `<loc>` from a flat `<urlset>` sitemap, XML-unescape and
 * normalize each to a path, and dedupe preserving first-seen order (so a
 * `/blog` and `/blog/` pair collapse to one entry). Throws on a
 * `<sitemapindex>` document, which is not supported.
 */
export function parseSitemap(xml: string): Array<string> {
  if (sitemapIndexPattern.test(xml)) {
    throw new Error("Sitemap index documents are not supported");
  }

  const paths: Array<string> = [];
  const seen = new Set<string>();

  for (const match of xml.matchAll(locPattern)) {
    const raw = match[1];
    if (raw == null) continue;
    const loc = unescapeXml(raw.trim());
    if (loc === "") continue;
    const path = normalizeSitemapLoc(loc);
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

/**
 * Identifies this crawler's outbound sitemap requests so site operators can
 * distinguish them in their access logs.
 */
export const sitemapUserAgent =
  "@beesolve/analytics-processor sitemap fetcher (+https://github.com/BeeSolve/packages)";

/**
 * Fetch a sitemap over HTTP and return its normalized, deduped paths. Throws
 * with the response status if the request is not successful.
 */
export async function fetchSitemapPaths(url: string): Promise<Array<string>> {
  const res = await fetch(url, { headers: { "user-agent": sitemapUserAgent } });
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseSitemap(text);
}

const locPattern = /<loc>([\s\S]*?)<\/loc>/gi;
const sitemapIndexPattern = /<sitemapindex/i;

const xmlEntities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function unescapeXml(value: string): string {
  return value.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => xmlEntities[entity] ?? entity);
}
