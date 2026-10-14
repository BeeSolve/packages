# @beesolve/analytics-processor

CloudFront analytics processor. Reads CloudFront standard-logs via Athena and
maintains a single-table DynamoDB design of hourly totals, per-dimension
breakdowns, and daily/monthly rollups using atomic counter updates with
per-period idempotency markers.

## Architecture

```
┌──────────────┐   hourly    ┌────────┐   ADD + marker   ┌──────────┐
│ CloudFront   │ ──────────► │ Athena │ ───────────────► │ DynamoDB │
│ v2 Parquet   │   query     │        │   (transaction)  │  totals  │
│ (S3 + Glue)  │             └────────┘                  │  breakdowns│
└──────────────┘                                         └──────────┘
                                                               ▲
                      daily / monthly rollups (read-back) ─────┘
```

An hourly Lambda runs exactly one partition-pruned Athena query over a closed
hour of v2 Parquet data and writes totals + per-dimension breakdowns with
atomic `ADD` updates, guarded by a per-hour `applied#...` marker written
conditionally in the same `TransactWriteCommand`. Daily and monthly rollup
Lambdas sum finer-grain DynamoDB items (never re-querying Athena). A one-time
standalone backfill script walks historic data through the same write path, and
a `compact` command rewrites legacy v1 logs into the v2 Parquet shape so they
can be read through that same path.

## Installation

```bash
npm install @beesolve/analytics-processor
```

## Exports

- `.` — schemas/types (`totalsSchema`/`TotalsItem`, `breakdownSchema`/`BreakdownItem`,
  `appliedMarkerSchema`/`AppliedMarker`, `configSchema`/`AnalyticsConfig`,
  `grains`/`Grain`, `dimensions`/`Dimension`),
  time/window helpers (`hourKey`, `dayKey`, `monthKey`, `maxWindowFor`,
  `windowKeys`, `shiftAnchor`, `hoursBetween`, `parsePeriodKey`, `grainForPeriodKey`),
  model classes (`Totals`,
  `Breakdowns`, `AppliedMarkers`, `Config`, `IpInfoCache` + `lookupIpInfo` + `IpInfo`/`IpInfoCacheItem`),
  pure helpers (`buildHourlyQuery`, `classifyDevice`, `sumTotals`,
  `sumBreakdown`, `topNWithOther`), live-aggregation resolvers
  (`resolveTotalsLive`/`resolveBreakdownLive`), and `processHour`
  (+ `applyDailyRollup`/`applyMonthlyRollup`).
- `./cdk` — the `AnalyticsProcessor` CDK construct.

Lambda handlers and the backfill script are not part of the public API.

## CDK Usage

```typescript
import { AnalyticsProcessor } from "@beesolve/analytics-processor/cdk";

const processor = new AnalyticsProcessor(this, "Analytics", {
  athenaDatabase: logging.glueDatabaseName,
  athenaV2Table: logging.glueTableName,
  athenaWorkgroup: logging.workgroupName,
  logBucketArn: logging.logBucket.bucketArn,
  athenaResultsBucketArn: logging.athenaResultsBucket.bucketArn,
  ipInfoApiKey: process.env.IPINFO_API_KEY,
});

// Grant read-only access to a dashboard Lambda. Sets ANALYTICS_TABLE_NAME and
// ANALYTICS_REVERSE_INDEX env vars on the handler.
processor.grantRead(dashboardLambda);
```

The construct provisions:

- DynamoDB table (on-demand, composite key `pk`/`sk`, reverse GSI `reverse`, TTL)
- Three Lambdas (Node.js 24): `Hourly`, `DailyRollup`, `MonthlyRollup`
- EventBridge schedules: hourly `rate(1 hour)`, daily cron (`00:15`), monthly cron (`01:30` on the 1st)
- Least-privilege Athena/Glue/S3 access for the hourly Lambda

## Backfill

> **Cost warning:** if your source is legacy v1 logs (many small gzip files),
> run [`compact`](./docs/how-to/compact-v1-logs.md) first and point `ATHENA_TABLE`
> at the compacted table. Backfilling a raw v1 table directly makes every hourly
> query fan out across tens of thousands of S3 objects — Athena issues at least
> one GET per file, which has cost **hundreds of dollars in S3 GET requests** for
> a single full backfill. Compacting first reduces that to cents.

The one-time backfill script walks historic log data through the same write
path as the hourly Lambda. It is resumable and exactly-once via the idempotency
markers — already-applied hours skip instantly. It reads the v2 Parquet table;
to backfill legacy v1 logs, first run [`compact`](./docs/how-to/compact-v1-logs.md)
to rewrite them into the v2 shape, then point `ATHENA_TABLE` at the compacted
table.

```bash
TABLE_NAME=... \
ATHENA_DATABASE=... ATHENA_TABLE=... ATHENA_WORKGROUP=... \
bun run backfill -- --from 2026-01-01T00:00:00Z --to 2026-01-31T23:00:00Z --concurrency 2 --rollups
```

- `--from` / `--to` — inclusive ISO hour range (required).
- `--concurrency` — bounded parallelism (default 2).
- `--rollups` — after the per-hour fill, run daily and monthly rollups over the range.

Credentials are resolved by the default AWS SDK chain (honors `AWS_PROFILE`).

## Compact

The `compact` command converts a legacy v1 `LazySimpleSerDe` log table into a
v2-shaped Parquet table (one file per hour-partition, v1 columns renamed to the
v2 schema), so queries stop fanning out across tens of thousands of tiny S3
objects. See the [how-to guide](./docs/how-to/compact-v1-logs.md).

```bash
bun run compact -- \
  --database cf_logs_db --source-table cf_logs_v1_backfill \
  --target-table cf_logs_v1_compact \
  --external-location s3://log-bucket/compact/v1/ \
  --workgroup primary --output-location s3://athena-results/ctas/ \
  --from 2025-10-16 --to 2026-10-13
```
