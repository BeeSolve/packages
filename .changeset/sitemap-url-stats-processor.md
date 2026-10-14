---
"@beesolve/analytics-processor": minor
---

Add sitemap URL stats: a separate, parallel model that recomputes per-day hit counts for a known set of sitemap URLs and stores one item per `(path, year-month)`, avoiding the `__other__` loss that drops genuine articles under bot traffic.

- `Config` gains `getSitemapConfig` and `setSitemapUrl` (only the sitemap URL is persisted on the shared config item; the path set is re-derived from the sitemap on each run and never stored).
- New `src/sitemap.ts`: `canonicalPath`, `normalizeSitemapLoc`, `parseSitemap`, `fetchSitemapPaths` (sends an identifying `User-Agent`), the `buildSitemapHourlyQuery` / `buildSitemapMonthlyQuery` Athena helpers, the `SitemapUrlStats` DynamoDB model (`getForUrl`, `getForMonth`, `buildAdd`, `buildOverwrite`), and the `processSitemapHour` / `processSitemapMonth` orchestration.
- The live hourly processor scans a single lagged hour and `ADD`s each path's hits into the running `(path, month)` counters inside a `TransactWrite` guarded by a per-hour applied-marker (exactly-once). The `sitemap-backfill` command instead recomputes a whole month in one Athena scan and overwrites with `SET` - one query per month instead of 720, matched to each direction's Athena cost profile.
- New hourly `sitemap` Lambda handler plus a `Sitemap` function and `SitemapSchedule` rule on the `AnalyticsProcessor` construct.
- New `sitemap-backfill` command for recomputing a month range.
