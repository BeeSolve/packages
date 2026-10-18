# @beesolve/analytics-processor

## 0.8.0

### Minor Changes

- 45182c5: Ship the operational commands as executable bins so consumers can run them
  without cloning the monorepo. The package now exposes `analytics-backfill`,
  `analytics-watch-backfill`, and `analytics-compact` (runnable via `npx`), each
  built as a self-contained Node bundle with a shebang. Previously these lived
  only as repo-local `bun run` scripts under `command/`, which were not published.
  Adds a how-to guide documenting the required env vars and usage.

## 0.7.1

### Patch Changes

- 3bf4809: Process active watch entries in the hourly cron. The hourly handler now lists
  active watch config and runs `processWatchHour` for each entry after the
  site-wide totals, so watch bucket stats (hits, bytes, cache) are populated every
  hour instead of never. Each entry is processed independently and is marker-guarded,
  and a failure on one entry is logged without aborting the rest of the run.

## 0.7.0

### Minor Changes

- def7f18: Add a decoupled SDK write path to `@beesolve/analytics-processor` and route the
  dashboard's sitemap-URL write through it.

  `@beesolve/analytics-processor` now ships a processor-owned SDK handler Lambda
  with read/write access to the analytics table, invoked through a typed
  `AnalyticsClient` from the new `@beesolve/analytics-processor/sdk` export. The
  client exposes `updateSitemapUrl({ sitemapUrl })`, which dispatches to the
  handler via synchronous Lambda invocation (mirroring the `@beesolve/auth-service`
  SDK pattern). The CDK construct's `grantRead(handler)` method is renamed to
  `grantAccess(handler)`: it still grants read-only access to the table and sets
  the `ANALYTICS_TABLE_NAME`/`ANALYTICS_REVERSE_INDEX` env vars, and additionally
  grants invoke on the SDK handler and sets `BEESOLVE_ANALYTICS_SDK_HANDLER_ARN`.

  `@beesolve/analytics-dashboard` keeps read-only table access and now routes the
  `setSitemapUrl` form action through `AnalyticsClient.updateSitemapUrl` instead of
  writing to DynamoDB directly (the dashboard handler has no write permission). The
  dashboard now requires the `BEESOLVE_ANALYTICS_SDK_HANDLER_ARN` environment
  variable, wired automatically by `AnalyticsProcessor.grantAccess`.

- 25b3bcf: Add additive cache counts, the unified watch model, a URL directory, and
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

### Patch Changes

- Updated dependencies [25b3bcf]
  - @beesolve/ip-info@0.3.0

## 0.6.2

### Patch Changes

- 7c1363a: Fix `SitemapUrlStats.getForMonth` returning non-sitemap records.

  The reverse index is keyed on `sk` (partition) + `pk` (sort), and `getForMonth`
  queried it with only `sk = :month`. Other record families written to the same
  table - notably the monthly totals rollup `totals#month` with `sk = "YYYY-MM"` -
  share that sort key, so the query also returned them and `parseOne` threw
  `Malformed stored sitemap url stat record`, surfacing as a 500 on the dashboard's
  sitemap view once sitemap stats and a monthly rollup both existed for a month.

  The query now constrains the index sort key with
  `begins_with(pk, "sitemapurl#")` in the key condition (not a filter, since `pk`
  is a primary-key attribute of the index), so only sitemap-url records are
  returned.

## 0.6.1

### Patch Changes

- 6e2debf: Fix two issues in the `compact` command surfaced by running it at range scale.

  - **Drop bucketing.** `0.6.0` wrote the compacted table with `bucket_count = 1`
    to force one file per partition. Athena forbids `INSERT` into a bucketed table,
    which is incompatible with the batched writes a range larger than ~100
    hour-partitions requires (seed CTAS + `INSERT` batches to stay under the
    100-open-writers cap). The table is now partitioned but not bucketed - which
    still delivers the entire cost win, because a single-hour query reads one
    hour-partition either way. One-file-per-partition is simply not achievable
    across a year of hourly partitions in Athena; the `0.6.0` docs claiming it were
    wrong and are corrected.
  - **`compact --drop-existing` now purges the target's S3 external location**
    before rebuilding. Athena CTAS refuses to write into a non-empty
    `external_location` (`HIVE_PATH_ALREADY_EXISTS`), and dropping the Glue table
    leaves its data files behind, so the previous `--drop-existing` (which only ran
    `DROP TABLE`) failed on re-run. It now lists and deletes every object under
    `--external-location`. Also fixes the `DROP TABLE` statement to use Athena DDL
    identifier quoting (backticks). Adds `@aws-sdk/client-s3` as a dependency and
    exposes `parseS3Location`.

## 0.6.0

### Minor Changes

- 99d7a13: Drop the legacy v1 log path and add an on-demand `compact` command.

  v1 CloudFront logs are tens of thousands of tiny gzip files; Athena issues at least one S3 GET per file, so a single-hour query fanned out across the whole table (a backfill once cost ~$350 in GET requests, not scan bytes). The fix is to compact v1 into the v2 Parquet shape once, then read only that - which also lets the processor carry a single code path instead of branching on `source`.

  Breaking changes (pre-1.0 `minor`):

  - Removed the `source` / `AppliedSource` concept entirely. `appliedSources` and `AppliedSource` are no longer exported from `keys`, and `buildHourlyQuery`, `runHourlyAthenaQuery`, `processHour`, `buildSitemapHourlyQuery`, `buildSitemapMonthlyQuery`, `runSitemapHourlyQuery`, `runSitemapMonthlyQuery`, `processSitemapHour`, and `processSitemapMonth` no longer take a `source` argument. They always read the v2 Parquet shape.
  - `columnMaps` (a `Record<AppliedSource, …>`) is replaced by a single `columnMap`.
  - `appliedMarkerSchema` no longer includes `source`, and `AppliedMarkers.buildMarkerPut` no longer accepts or writes it. The schema is now a `looseObject` so existing markers that still carry a `source` attribute continue to validate; the attribute is simply never read or written again.
  - `BackfillConfig.athenaV1Table` is renamed to `athenaTable`; the `backfill` and `sitemap-backfill` commands read `ATHENA_TABLE` (point it at the compacted table) instead of `ATHENA_V1_TABLE`.
  - The `sitemap-backfill` command drops its `--source` flag and its `SitemapBackfillArgs.source` field; it always reads the v2-shaped table.

  New:

  - `command/compact.ts` + `compact` npm script: a reusable one-time compaction that converts a v1 LazySimpleSerDe log table into a v2-shaped Parquet table - Parquet, partitioned by `year/month/day/hour`, one file per partition (via a single bucket), with v1 column names renamed to the v2 schema. It seeds the table with a CTAS and appends the rest in <=4-day batches so Athena/Trino never trips the 100-open-writers limit.
  - Exposes `buildCompactSelect`, `buildSeedCtas`, `buildInsert`, `planDateBatches`, `parseCompactArgs`, `runCompact`, and `compactColumnMap`.
  - ADR-008 records why ongoing scheduled v2 compaction was considered and deliberately deferred (v2 is already Parquet and hour-partitioned, so the win is marginal; if ever built, do it monthly as a step on the existing monthly rollup).

## 0.5.0

### Minor Changes

- 1947290: Add sitemap URL stats: a separate, parallel model that recomputes per-day hit counts for a known set of sitemap URLs and stores one item per `(path, year-month)`, avoiding the `__other__` loss that drops genuine articles under bot traffic.

  - `Config` gains `getSitemapConfig` and `setSitemapUrl` (only the sitemap URL is persisted on the shared config item; the path set is re-derived from the sitemap on each run and never stored).
  - New `src/sitemap.ts`: `canonicalPath`, `normalizeSitemapLoc`, `parseSitemap`, `fetchSitemapPaths` (sends an identifying `User-Agent`), the `buildSitemapHourlyQuery` / `buildSitemapMonthlyQuery` Athena helpers, the `SitemapUrlStats` DynamoDB model (`getForUrl`, `getForMonth`, `buildAdd`, `buildOverwrite`), and the `processSitemapHour` / `processSitemapMonth` orchestration.
  - The live hourly processor scans a single lagged hour and `ADD`s each path's hits into the running `(path, month)` counters inside a `TransactWrite` guarded by a per-hour applied-marker (exactly-once). The `sitemap-backfill` command instead recomputes a whole month in one Athena scan and overwrites with `SET` - one query per month instead of 720, matched to each direction's Athena cost profile.
  - New hourly `sitemap` Lambda handler plus a `Sitemap` function and `SitemapSchedule` rule on the `AnalyticsProcessor` construct.
  - New `sitemap-backfill` command for recomputing a month range.

## 0.4.0

### Minor Changes

- bd6b5d8: Correct partial-period aggregation and surface bucket processing state.

  Processor:

  - Partial periods are now computed from exactly one grain finer, following only the current edge deeper: a partial month sums the stored day aggregates for its finished days plus the live current day (which sums hours), and a partial year sums stored month aggregates plus the live current month. A partial month no longer fans out to hourly records for its finished days, keeping the read count bounded (a year touches ~12 months + ~31 days + ~24 hours) and the request sub-second.
  - Add `classifyBucketState` / `BucketState` (`sealed` | `partial` | `pending`) so a finalized zero-traffic bucket can be told apart from one that has not been processed yet. Classification is marker-driven.

  Dashboard:

  - The overview chart distinguishes the three bucket states: final (solid), in-progress/partial (striped), and awaiting-processing/pending (a faint dashed ghost), with a legend and explanatory tooltips, so empty-because-no-data reads differently from empty-because-not-yet-calculated.

## 0.3.0

### Minor Changes

- ef6f582: Dashboard UX improvements and on-the-fly partial aggregation.

  Processor:

  - Add `Config` model persisting the earliest ingested hour (`system#config` / `analytics`) so the dashboard can clamp navigation to a known start boundary. `processHour` records it on first data, and the backfill moves it earlier when older hours are ingested.
  - Add `resolveTotalsLive` / `resolveBreakdownLive`: an in-progress period (and any past period still missing its rollup marker) is computed on the fly from the grain below it, so the current day sums the hours ingested so far and the current month folds down through the current day. Sealed past periods are read from their stored rollup.
  - Add `parsePeriodKey` / `grainForPeriodKey` time helpers.

  Dashboard:

  - Overview and breakdown screens now compute the current, not-yet-rolled-up period live instead of showing it empty.
  - Period/grain state moved into URL parameters so views are bookmarkable.
  - Replace the free-text period input with a clamped picker (year/month/day/hour dropdowns) that jumps directly to any point in `[start, now]` and never navigates before the first record or into the future.
  - Time buckets are shown as human, local-timezone labels (an hour bucket reads as the clock range it spans) instead of the internal `YYYY-MM-DD-HH` key.
  - Fix unreadable selected breakdown/grain buttons.
  - Bar-chart tooltips now use the graffiti `.tooltip` component.

## 0.2.6

### Patch Changes

- 0e4eb80: Restructure the hourly Athena query so the device classification and the numeric
  casts happen in an inner subquery, and `GROUP BY GROUPING SETS` references plain
  column references in the outer query. Athena/Trino rejects a GROUPING SETS element
  that is a select alias or a computed expression (`COLUMN_NOT_FOUND` for the
  `device` alias, `INVALID_COLUMN_REFERENCE` for the inlined CASE expression). The v2
  column map now casts the numeric columns (`sc_status`, `sc_bytes`, `cs_bytes`,
  `time_taken`) because CloudFront v2 Parquet stores every field as BINARY/string, so
  the previous bare references mis-behaved in `sum`/`BETWEEN`/`approx_percentile`.
  Output column names are unchanged, so the result parser is unaffected.
- Updated dependencies [0e4eb80]
  - @beesolve/cdk-constructs@0.8.1

## 0.2.5

### Patch Changes

- 000dcd7: Grant the hourly processor Lambda `s3:GetBucketLocation` and `s3:ListBucket` on the Athena
  results bucket (in addition to `s3:PutObject`/`s3:GetObject`). Athena verifies the output
  bucket before running a query, and without these actions `StartQueryExecution` fails with
  `InvalidRequestException: Unable to verify/create output bucket ... (INSUFFICIENT_PERMISSIONS)`,
  so every hourly run errored and no analytics data was ever written to DynamoDB.

## 0.2.4

### Patch Changes

- Updated dependencies [a185bd5]
  - @beesolve/cdk-constructs@0.8.0

## 0.2.3

### Patch Changes

- Updated dependencies [b34d2a6]
  - @beesolve/cdk-constructs@0.7.0

## 0.2.2

### Patch Changes

- Updated dependencies [09efb63]
  - @beesolve/cdk-constructs@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [b868372]
  - @beesolve/cdk-constructs@0.5.0

## 0.2.0

### Minor Changes

- 6fc65b5: Export `requiredRecordFields`: the 10 normalized CloudFront log column names the hourly
  processor reads. Pass it as `CloudFrontAccessLoggingSettings`' `athena.recordFields` to
  deliver only the fields the processor needs, shrinking the Parquet objects and cutting
  Athena scan cost. See `docs/how-to/reduce-athena-cost.md`.
- 6fc65b5: Add `@beesolve/analytics-processor` — CloudFront analytics aggregation and storage.

  The package turns CloudFront standard-logs (queried via Athena) into a bounded,
  fast-to-read DynamoDB single-table design of hourly totals, per-dimension breakdowns
  (status, country, device, path), and daily/monthly rollups. Writes use atomic `ADD`
  counter updates guarded by per-period `applied#...` idempotency markers written
  conditionally in the same transaction, so processing is exactly-once and safe to re-run.

  Public API (`.`): typed schemas (`totalsSchema`/`TotalsItem`, `breakdownSchema`/`BreakdownItem`,
  `appliedMarkerSchema`/`AppliedMarker`, `grains`/`Grain`, `dimensions`/`Dimension`),
  time/window helpers (`hourKey`, `dayKey`, `monthKey`, `maxWindowFor`, `windowKeys`,
  `shiftAnchor`, `hoursBetween`), model classes (`Totals`, `Breakdowns`, `AppliedMarkers`,
  `IpInfoCache` + `lookupIpInfo`), pure helpers (`buildHourlyQuery`, `classifyDevice`,
  `sumTotals`, `sumBreakdown`, `topNWithOther`), and `processHour` (+ `applyDailyRollup`/`applyMonthlyRollup`).

  `./cdk` exports the `AnalyticsProcessor` construct, which provisions the table + reverse
  GSI, three scheduled Lambdas (hourly processor + daily/monthly rollups) with least-privilege
  Athena/Glue/S3 access, and a read-only `grantRead(handler)` helper for a dashboard. A
  one-time standalone backfill script (`bun run backfill`) walks historic v1 data through
  the same write path.

### Patch Changes

- dfc3824: Source the IP enrichment cache from the new shared `@beesolve/ip-info` package instead
  of a local copy.

  The duplicated `ipInfo.ts` has been removed and the root barrel now re-exports
  `@beesolve/ip-info`, so the package's public API still surfaces `IpInfoCache`,
  `lookupIpInfo`, `IpInfo`, and `IpInfoCacheItem` unchanged. No behavior change.

- Updated dependencies [029b8eb]
- Updated dependencies [dfc3824]
  - @beesolve/cdk-constructs@0.4.0
  - @beesolve/ip-info@0.2.0
