/**
 * Collapse a single trailing slash on a URI column in SQL so `/blog/` and
 * `/blog` fold together, mirroring {@link ../src/sitemap.ts canonicalPath} on
 * the application side. Root `/` is preserved. Shared by the sitemap and watch
 * Athena queries so both address the log-side URI identically.
 */
export function canonicalUriExpr(uriColumn: string): string {
  return `CASE WHEN length(${uriColumn}) > 1 AND substr(${uriColumn}, -1) = '/' THEN substr(${uriColumn}, 1, length(${uriColumn}) - 1) ELSE ${uriColumn} END`;
}

/**
 * Double single quotes so a value can be embedded in a single-quoted SQL string
 * literal.
 */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Parse an Athena result cell into a count, treating `undefined`, empty, and
 * non-numeric cells as `0`.
 */
export function toCount(value: string | undefined): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
