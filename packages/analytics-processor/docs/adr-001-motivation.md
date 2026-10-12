# ADR-001: Why This Package Exists

## Status

Accepted

## Context

A site served behind CloudFront delivers access logs to S3. Part 1 of the
CloudFront analytics work upgrades the
[`CloudFrontAccessLoggingSettings`](../../cdk-constructs/src/cloudFrontAccessLoggingSettings.ts)
construct to emit standard logging v2 (Apache Parquet, Hive partitioning, field
selection) alongside a Glue table and Athena workgroup. That construct's
responsibility ends at making the logs queryable; it does not aggregate them,
own any analytics schema, or run any schedule.

That leaves a gap. Turning raw per-request log rows into bounded, fast-to-read
analytics needs its own concerns: a DynamoDB single-table design (totals,
breakdowns, idempotency markers) with a reverse GSI, an hourly Lambda that runs
exactly one partition-pruned Athena query per closed hour and writes via atomic
counter updates, daily and monthly rollup Lambdas that read earlier items back
instead of re-querying Athena, country enrichment from client IPs, and a
one-time backfill over historic v1 data. These do not belong in a CDK logging
construct, and they do not belong in the dashboard that reads the results.

## Decision

Provide `@beesolve/analytics-processor` as the standalone package that owns
CloudFront analytics **aggregation and storage**. It:

- Owns the single-table DynamoDB schema (time-series `totals`, per-dimension
  `breakdowns`, `applied#...` idempotency markers) and the reverse GSI.
- Runs an hourly Lambda that queries one closed hour of v2 Parquet data via
  Athena and writes totals + breakdowns with atomic `ADD` updates guarded by a
  per-hour idempotency marker in the same transaction.
- Runs daily and monthly rollup Lambdas that sum finer-grain DynamoDB items
  rather than re-querying Athena.
- Ships a one-time standalone backfill script that walks historic v1 data
  through the same write path, resumable and exactly-once via the markers.
- Exposes typed schemas, pure time/window helpers, model classes, and a CDK
  construct (`AnalyticsProcessor`) with a read-only `grantRead` for the
  dashboard.

## Rationale

### 1. Ownership follows the data

The processor owns the table, the schema, the aggregation logic, and the write
path. The dashboard consumes its model classes read-only, so the analytics
schema has exactly one owner and the dashboard reimplements nothing.

### 2. Separation from collection

The logging construct's job is to make logs queryable. Keeping aggregation out
of it preserves that single responsibility and lets the processor evolve its
schema and schedules independently of how logs are collected.

### 3. Exactly-once by construction

Atomic `ADD` counter updates avoid read-modify-write races, and a per-period
`applied#...` marker written conditionally in the same transaction makes each
hour, day, and month idempotent. This is what lets the backfill overlap the
hourly schedule and be safely re-run.

### 4. Backfill shares the write path

The one-time backfill is a standalone script, not new infrastructure, that
calls the same `processHour` entry point as the hourly Lambda against the v1
table. One write path means one place for the schema and idempotency rules.

## Consequences

- The processor is the single owner of the analytics DynamoDB schema; readers
  depend on its exports and CDK grants rather than touching the table directly.
- Rollups never call Athena, so coarse aggregates cost only DynamoDB reads.
- Deploying analytics requires this package alongside the upgraded logging
  construct; it is not usable on its own, which is inherent to its role.
- One processor instance serves one distribution (single-site); there is no
  `siteId` in the keys.

## Alternatives Considered

### Aggregate inside the logging CDK construct

Rejected. It would couple a logging construct to a DynamoDB schema, Athena
clients, and three schedules it has no reason to own, and would force every
logging deployment to carry analytics infrastructure.

### Aggregate inside the dashboard

Rejected. It would put scheduled backend Lambdas, table ownership, and a
batch backfill inside a SvelteKit request/response app, coupling their
deployment and scaling and blurring backend/frontend responsibilities.

### Query Athena on every dashboard read

Rejected. Athena per request is slow and expensive and does not bound cost.
Pre-aggregating into DynamoDB with atomic counters keeps reads cheap, bounded
`Query` calls with no `Scan`.

## References

- [`CloudFrontAccessLoggingSettings`](../../cdk-constructs/src/cloudFrontAccessLoggingSettings.ts)
  — the v2 logging construct the processor queries
- `@beesolve/dmarc-consumer` — the persistence/aggregation package this one is
  modeled on
