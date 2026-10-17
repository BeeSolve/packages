---
"@beesolve/analytics-processor": minor
---

Add additive cache counts, the unified watch model, a URL directory, and
approximate unique visitors; remove the path breakdown dimension; move sitemap
sync and uniques into the rollups.

- Cache counts are now additive raw counts (`cacheHits` = Hit+RefreshHit,
  `cacheMisses` = Miss, `cacheErrors` = Error+LimitExceeded+CapacityExceeded) on
  the site-wide totals, correct at every grain. BREAKING: the non-additive
  `cacheHitRatio` field is removed; compute the ratio from the counts. The three
  counts are tolerant on read (`v.optional(v.number(), 0)`) so totals records
  written before this change still parse, defaulting to 0.
- BREAKING: the `path` breakdown dimension (and its `__other__` top-N bucket) is
  removed. `dimensions` is now `status`, `country`, `device`. The
  `topNWithOther` helper is removed. Existing stored `breakdown#path#...` records
  are left to age out of the hourly TTL and sit unused at day/month grain.
- New unified watch model (`WatchStats`, watch config methods on `Config`) with
  matcher modes `exact`/`split`/`group`, `source` (`sitemap`/`manual`), and
  `status` (`active`/`stopped`). Sitemap URLs become `source="sitemap"` watch
  entries. Watch metrics (hits, bytesSent, cacheHits/Misses/Errors, bytesSaved,
  errors, redirects) are collected hourly into a durable `(pk, YYYY-MM)` record
  with per-day `dNN` hits and no TTL.
- New `UrlDirectory` (`pk=<url>, sk="url"`, `firstSeen` only), upserted once per
  day in the daily rollup.
- Approximate unique visitors via Athena `approx_distinct(ip)`: site-wide day
  uniques in the daily rollup and a fresh site-wide month scan in the monthly
  rollup, stored as a non-additive `uniqueVisitors` on the day/month totals. No
  year uniques. Per-country uniques are not available (CloudFront logs carry no
  country column).
- The daily and monthly rollup handlers now use Athena (new IAM + env) for the
  URL directory, uniques, and daily sitemap sync+diff.
- BREAKING: the standalone hourly sitemap handler, its schedule, and the
  `SitemapUrlStats` metric model are removed (sitemap parsing/fetch is kept and
  now drives the daily sync). The `sitemap-backfill` command is replaced by
  `watch-backfill`.
- The SDK handler and `AnalyticsClient` gain `upsertWatch`, `setWatchStatus`,
  `deleteWatch`, and `syncSitemapNow`. `grantAccess` now also injects
  `ANALYTICS_PROCESSING_LAG_HOURS` and `ANALYTICS_HOURLY_TTL_DAYS`, and
  `AnalyticsProcessor` exposes `processingLagHours`/`hourlyTtlDays`.
