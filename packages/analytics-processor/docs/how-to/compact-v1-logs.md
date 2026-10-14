# How to: Compact legacy v1 logs into the v2 Parquet shape

If you have historical CloudFront logs in the **legacy v1 format** (tab-delimited
`LazySimpleSerDe`, one small gzip file per delivery), querying them directly is
expensive - not because of bytes scanned, but because Athena issues at least one
S3 **GET per file**. A table of ~90K tiny files makes every single-hour query fan
out across the whole table. A one-off backfill over such a table has cost
hundreds of dollars in GET requests alone.

The `compact` command rewrites that v1 table into the **v2 Parquet shape**:
Parquet, partitioned by `year/month/day/hour`, with the v1 column names renamed
to the v2 schema. After compaction, a single-hour query reads one hour-partition
(a handful of files) instead of fanning out across tens of thousands of objects,
and - because the compacted table is column-for-column identical to the live v2
Glue table - the processor's `backfill` and `sitemap-backfill` commands can read
it directly with no v1-specific code.

## Run it

```sh
bun run compact -- \
  --database cf_logs_db \
  --source-table cf_logs_v1_backfill \
  --target-table cf_logs_v1_compact \
  --external-location s3://my-log-bucket/compact/v1/ \
  --workgroup primary \
  --output-location s3://my-athena-results/compact-ctas-results/ \
  --from 2025-10-16 \
  --to 2026-10-13
```

- `--external-location` is where the compacted Parquet is written. Use a prefix
  **separate** from the raw logs; the raw v1 data is never modified.
- `--workgroup` must be one that does **not** enforce a centralized output
  location (e.g. `primary`), because the CTAS writes to `--external-location`. A
  workgroup with `EnforceWorkGroupConfiguration` rejects it.
- `--output-location` is where Athena writes query results/metadata; required
  when the workgroup has no default.
- `--drop-existing` drops the target table first so a re-run is idempotent.

## How it stays within Athena limits

Partitioning opens one writer per hour-partition, and Trino caps concurrent open
writers at 100. The command therefore seeds the table with a `CREATE TABLE ... AS`
for the first batch, then appends the rest in `INSERT INTO` statements of at most
**4 days each** (<=96 hour-partitions per statement).

The table is deliberately **not bucketed**. Bucketing with `bucket_count = 1`
would force one file per partition, but Athena forbids `INSERT` into a bucketed
table - and a range larger than ~100 hour-partitions must be written across
multiple `INSERT` statements. Those two constraints are mutually exclusive, so
compaction partitions the data (which is what collapses the per-hour query cost)
but leaves a handful of files per hour-partition rather than exactly one. For the
hourly query pattern that is all that matters: the query reads a single
hour-partition either way.

## After compaction

Point the processor's backfill at the compacted table:

```sh
ATHENA_TABLE=cf_logs_v1_compact bun run backfill -- --from … --to … --rollups
```

The compaction is **lossless** (a straight projection + rename), so a
`SELECT count(*)` over the compacted table matches the source row-for-row.

For the reusable builders behind the command (`buildCompactSelect`,
`buildSeedCtas`, `buildInsert`, `planDateBatches`), import them from the package
root.
