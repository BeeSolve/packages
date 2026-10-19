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

## Three traffic tiers (all / real / watch)

The totals and `status`/`country`/`device` breakdowns are computed in three parallel
tiers, each stored in its own namespace with its own applied markers:

- **all** (unchanged): every logged request. Keys `totals#<grain>`,
  `breakdown#<dimension>#<grain>#<periodKey>`.
- **real**: successful HTML page views only
  (`sc_content_type LIKE 'text/html%' AND sc_status BETWEEN 200 AND 299`). O(1) in
  query size. Keys `totals#real#…`, `breakdown#real#…`. Requires `sc_content_type` in
  the delivered record fields (see below); populates from the redeploy forward.
- **watch**: the active `source="sitemap"` URL set (a canonical `IN` list). Keys
  `totals#watch#…`, `breakdown#watch#…`. No-ops when no sitemap is configured.

Each tier has its own `applied#<tier>-<grain>#<periodKey>` marker, so tiers are
processed, rolled up, and backfilled independently. The read resolvers
(`resolveTotalsLive`, `resolveBreakdownLive`, `classifyBucketState`) take a `tier`
argument defaulting to `all`.

Enabling the `real` tier requires `sc_content_type` in the CloudFront log delivery:
it is already part of the exported `requiredRecordFields`, so consumers that configure
delivery from that constant pick it up on redeploy. There is no historical backfill for
`real` — the column does not exist in logs delivered before the change.

See [ADR-010](./docs/adr-010-real-traffic-breakdowns.md) and
[the how-to guide](./docs/how-to/traffic-tiers.md).

## How-To Guides

- [Run the operational commands](./docs/how-to/run-operational-commands.md) - the
  `analytics-backfill`, `analytics-watch-backfill`, and `analytics-compact` bins that
  ship with the package, runnable via `npx` from a consumer project (no repo clone)
- [Reduce Athena cost](./docs/how-to/reduce-athena-cost.md) - deliver only the 11 fields
  the processor needs via the exported `requiredRecordFields`
- [Compact legacy v1 logs](./docs/how-to/compact-v1-logs.md) - the `compact` command that
  rewrites tiny-file v1 logs into the v2 Parquet shape (one file per hour-partition) so
  queries stop fanning out across tens of thousands of S3 objects. **Run this before
  backfilling any legacy v1 source** - backfilling raw v1 directly can cost hundreds of
  dollars in S3 GET requests.
- [Track per-article hits with sitemap URL stats](./docs/how-to/sitemap-url-stats.md) - the
  `sitemapUrl` config, the hourly sitemap processor, and the `SitemapUrlStats` read model
- [Filter to real / sitemap traffic with tiers](./docs/how-to/traffic-tiers.md) - the
  `all` / `real` / `watch` tiers, enabling them, and the `--tier`/`--force` backfill

## Further Reading

- [README](./README.md) - API reference and usage
- [CHANGELOG](./CHANGELOG.md) - Version history
