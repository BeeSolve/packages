---
"@beesolve/cdk-constructs": minor
---

Make `CloudFrontAccessLoggingSettings` CloudFront standard logging v2 (Parquet) only.

The construct now delivers access logs exclusively in Apache Parquet with Hive-compatible
partitioning and a selectable set of record fields, which makes Athena scans cheaper and
faster than the legacy tab-delimited format. All legacy (v1) code is removed: there is no
LazySimpleSerDe text table, no v1 sample query, and no `glueV1TableName`.

Breaking changes (acceptable: 0.x, internal-only, no compatibility shim):

- The `athena` prop is flat — providing it provisions the v2 Parquet pipeline. The nested
  `v2: { enabled; glueV2TableName?; outputPrefix? }` object and the `enabled` flag are
  gone. New shape:
  `{ account; glueDbName?; glueTableName? (default cf_logs_table); workGroupName?; outputPrefix? (default "v2"); recordFields?; createSampleQuery? }`.
- The single Parquet Glue table defaults to `cf_logs_table` (was `cf_logs_v2_table`).
- Glue column names are normalized (lowercase, hyphens→underscores, parentheses stripped,
  e.g. `sc_status`, `cs_user_agent`) so downstream Athena queries resolve — the previous
  hyphenated names were a bug.
- The read-only getters are replaced by public readonly members: `logBucket`,
  `athenaResultsBucket`, `glueDatabaseName`, `glueTableName` (replaces `glueV2TableName`),
  `workgroupName`. `glueV1TableName` is removed.

A single field array drives both the Glue table columns (normalized names) and the
delivery `recordFields` (CloudFront field tokens). `recordFields` selects a subset of
normalized field names (default: all); `enableV2Logging({ distributionArn })` is unchanged
in shape but its delivery fields now follow the selection. A one-time, operator-run
migration guide (`docs/how-to/migrate-v1-to-v2-logging.md`) covers retaining historic v1
data for backfill.
