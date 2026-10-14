---
"@beesolve/analytics-processor": minor
---

Drop the legacy v1 log path and add an on-demand `compact` command.

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
