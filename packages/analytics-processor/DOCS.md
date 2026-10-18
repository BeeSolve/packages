# @beesolve/analytics-processor - Documentation

**Keywords:** CloudFront analytics, Athena, DynamoDB totals, breakdowns, rollups, AnalyticsProcessor construct, grantRead, processHour, hourKey, windowKeys, Grain, Dimension, backfill, compact, v1 log compaction, Parquet, sitemap URL stats, SitemapUrlStats, getForUrl, getForMonth, canonicalPath

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/analytics-processor

See the [README](./README.md) for the API reference and usage, the how-to guides below for
task-focused walkthroughs, and the GitHub repository for source and examples.

## Sitemap URL stats

The hourly breakdown keeps only a top-100-by-hits `path` list per hour; everything else
collapses into `__other__`, so genuine articles are lost under bot traffic. Sitemap URL stats
are a separate, parallel model that accumulates per-day hit counts for a known set of URLs
(the site's sitemap) and stores one item per `(path, year-month)`.

- **Config**: set `sitemapUrl` on the shared config item (`Config.setSitemapUrl`); the hourly
  sitemap processor fetches and resolves it to a path set.
- **Processor**: an hourly Lambda scans one lagged hour and `ADD`s each sitemap path's hits
  into that day's `dNN` + the `hits` month rollup, guarded by a per-hour applied-marker so the
  hour counts exactly once.
- **Read model**: `SitemapUrlStats` with `getForUrl` (one URL across months) and
  `getForMonth` (all URLs in a month, for month-over-month comparison).

See [the how-to guide](./docs/how-to/sitemap-url-stats.md) and
[ADR-007](./docs/adr-007-sitemap-url-stats.md) for details.

## How-To Guides

- [Run the operational commands](./docs/how-to/run-operational-commands.md) - the
  `analytics-backfill`, `analytics-watch-backfill`, and `analytics-compact` bins that
  ship with the package, runnable via `npx` from a consumer project (no repo clone)
- [Reduce Athena cost](./docs/how-to/reduce-athena-cost.md) - deliver only the 10 fields
  the processor needs via the exported `requiredRecordFields`
- [Compact legacy v1 logs](./docs/how-to/compact-v1-logs.md) - the `compact` command that
  rewrites tiny-file v1 logs into the v2 Parquet shape (one file per hour-partition) so
  queries stop fanning out across tens of thousands of S3 objects. **Run this before
  backfilling any legacy v1 source** - backfilling raw v1 directly can cost hundreds of
  dollars in S3 GET requests.
- [Track per-article hits with sitemap URL stats](./docs/how-to/sitemap-url-stats.md) - the
  `sitemapUrl` config, the hourly sitemap processor, and the `SitemapUrlStats` read model

## Further Reading

- [README](./README.md) - API reference and usage
- [CHANGELOG](./CHANGELOG.md) - Version history
