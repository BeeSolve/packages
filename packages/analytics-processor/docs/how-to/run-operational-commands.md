# How to: run the operational commands (backfill, watch-backfill, compact)

The package ships three operational commands as **executable bins**, so a
consumer can run them from their own project without cloning this repository:

| Bin                        | Purpose                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `analytics-backfill`       | Walk a historic hour range through the hourly write path, optionally running daily/monthly rollups.                      |
| `analytics-watch-backfill` | Recompute watch-entry monthly stats for the active watch entries over a month range (idempotent `SET`, no marker guard). |
| `analytics-compact`        | Rewrite legacy v1 CloudFront logs into the v2 Parquet shape.                                                             |

Each bin is a self-contained bundle with a `#!/usr/bin/env node` shebang; run it
with `npx` (or your package manager's equivalent) once the package is installed.

## Credentials and configuration

The commands talk to DynamoDB, Athena, Glue and S3 using the ambient AWS
credentials (`AWS_PROFILE` / `AWS_REGION` or the standard credential chain), the
same as any AWS SDK process.

There are two ways to supply the processor configuration (table name, Athena
database/table/workgroup, etc.):

### 1. `--stack <name>` (recommended)

Pass the name of the CloudFormation stack the `AnalyticsProcessor` construct was
deployed into. The command calls `cloudformation:DescribeStacks` and reads the
config from the stack's outputs, so you do not have to look up any resource
names by hand:

```sh
AWS_PROFILE=my-profile AWS_REGION=eu-central-1 \
npx analytics-watch-backfill --stack MyAnalyticsStack --from 2026-05 --to 2026-10
```

This requires the stack to have been deployed with a construct version that
publishes the config outputs (`AnalyticsTableName`, `AnalyticsAthenaDatabase`,
`AnalyticsAthenaTable`, `AnalyticsAthenaWorkgroup`, etc.). Any explicit
environment variable still overrides the stack-derived value.

### 2. Environment variables

Without `--stack`, the commands read their configuration from environment
variables:

| Env var                  | `backfill` | `watch-backfill` | Notes                                                                         |
| ------------------------ | :--------: | :--------------: | ----------------------------------------------------------------------------- |
| `TABLE_NAME`             |     ✓      |        ✓         | The analytics DynamoDB table.                                                 |
| `REVERSE_INDEX_NAME`     |  optional  |        ✓         | Required by `watch-backfill` (`listWatch` GSI).                               |
| `ATHENA_DATABASE`        |     ✓      |        ✓         | Glue database.                                                                |
| `ATHENA_TABLE`           |     ✓      |        ✓         | Glue table. Note: this is `ATHENA_TABLE`, not the lambdas' `ATHENA_V2_TABLE`. |
| `ATHENA_WORKGROUP`       |     ✓      |        ✓         | Athena workgroup.                                                             |
| `ATHENA_OUTPUT_LOCATION` |  optional  |     optional     | Only when the workgroup has no default output.                                |

With `--stack`, a `watch-backfill` run collapses to:

```sh
AWS_PROFILE=my-profile AWS_REGION=eu-central-1 \
npx analytics-watch-backfill --stack MyAnalyticsStack --from 2026-05 --to 2026-10
```

`compact` also accepts `--stack` to fill in `--database`, `--workgroup`,
`--output-location`, and (when the stack defines a v1 table) `--source-table`;
`--target-table` and `--external-location` remain explicit since compaction
creates a new table the construct does not own.

## watch-backfill

Recompute the active watch entries' monthly stats over an inclusive month range.
Safe to re-run: it overwrites each `(bucket, month)` item with `SET` and is not
marker-guarded, so it reprocesses already-applied periods.

```sh
AWS_PROFILE=my-profile AWS_REGION=eu-central-1 \
TABLE_NAME=MyStack-AnalyticsTable \
REVERSE_INDEX_NAME=reverse \
ATHENA_DATABASE=cf_logs_db \
ATHENA_TABLE=cf_logs_table \
ATHENA_WORKGROUP=cf_workgroup \
npx analytics-watch-backfill --from 2026-05 --to 2026-10
```

- `--from` / `--to` are inclusive `YYYY-MM` months.
- `--concurrency <n>` optionally parallelizes the Athena queries (default 2).
- Only entries with `status: "active"` are processed.

## backfill

Walk a historic hour range through the same write path the hourly Lambda uses.

```sh
AWS_PROFILE=my-profile AWS_REGION=eu-central-1 \
TABLE_NAME=MyStack-AnalyticsTable \
ATHENA_DATABASE=cf_logs_db \
ATHENA_TABLE=cf_logs_table \
ATHENA_WORKGROUP=cf_workgroup \
npx analytics-backfill --from 2026-01-01T00:00:00Z --to 2026-01-31T23:00:00Z --rollups
```

- `--from` / `--to` are inclusive ISO timestamps (hour granularity).
- `--rollups` additionally runs the daily and monthly rollups for the range.
- `--concurrency <n>` optionally parallelizes (default 2).
- `--tier <all|real|watch>` selects which tier(s) to backfill (repeatable;
  default: all three). See [Traffic tiers](./traffic-tiers.md).
- `--force` reprocesses even hours/periods already marked applied, overwriting
  them. Without it, applied hours are skipped (marker-guarded).

## compact

Rewrite legacy v1 logs into the v2 Parquet shape. See
[Compact legacy v1 logs](./compact-v1-logs.md) for the full explanation; the bin
form is:

```sh
AWS_PROFILE=my-profile AWS_REGION=eu-central-1 \
npx analytics-compact \
  --database cf_logs_db \
  --source-table cf_logs_v1_backfill \
  --target-table cf_logs_v1_compact \
  --external-location s3://my-log-bucket/compact/v1/ \
  --workgroup primary \
  --output-location s3://my-athena-results/compact-ctas-results/ \
  --from 2025-10-16 --to 2026-10-13
```

## Running from a repo checkout

Inside this monorepo the same commands are available as package scripts, which
is convenient during development:

```sh
bun run backfill -- --from … --to …
bun run watch-backfill -- --from … --to …
bun run compact -- --database … --from … --to …
```
