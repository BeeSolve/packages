# @beesolve/analytics-processor

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
