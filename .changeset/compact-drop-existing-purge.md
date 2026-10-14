---
"@beesolve/analytics-processor": patch
---

Fix two issues in the `compact` command surfaced by running it at range scale.

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
