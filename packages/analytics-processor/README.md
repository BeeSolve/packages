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
standalone backfill script walks historic v1 data through the same write path.

## Installation

```bash
npm install @beesolve/analytics-processor
```

## Exports

- `.` — schemas/types (`totalsSchema`/`TotalsItem`, `breakdownSchema`/`BreakdownItem`,
  `appliedMarkerSchema`/`AppliedMarker`, `grains`/`Grain`, `dimensions`/`Dimension`),
  time/window helpers (`hourKey`, `dayKey`, `monthKey`, `maxWindowFor`,
  `windowKeys`, `shiftAnchor`, `hoursBetween`), model classes (`Totals`,
  `Breakdowns`, `AppliedMarkers`, `IpInfoCache` + `lookupIpInfo` + `IpInfo`/`IpInfoCacheItem`),
  pure helpers (`buildHourlyQuery`, `classifyDevice`, `sumTotals`,
  `sumBreakdown`, `topNWithOther`), and `processHour` (+ `applyDailyRollup`/`applyMonthlyRollup`).
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

The one-time backfill script walks historic v1 log data through the same write
path as the hourly Lambda. It is resumable and exactly-once via the idempotency
markers — already-applied hours skip instantly.

```bash
TABLE_NAME=... \
ATHENA_DATABASE=... ATHENA_V1_TABLE=... ATHENA_WORKGROUP=... \
bun run backfill -- --from 2026-01-01T00:00:00Z --to 2026-01-31T23:00:00Z --concurrency 2 --rollups
```

- `--from` / `--to` — inclusive ISO hour range (required).
- `--concurrency` — bounded parallelism (default 2).
- `--rollups` — after the per-hour fill, run daily and monthly rollups over the range.

Credentials are resolved by the default AWS SDK chain (honors `AWS_PROFILE`).
