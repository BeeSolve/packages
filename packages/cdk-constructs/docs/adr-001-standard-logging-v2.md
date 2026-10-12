# ADR-001: CloudFront Standard Logging v2 in CloudFrontAccessLoggingSettings

## Status

Accepted

## Context

`CloudFrontAccessLoggingSettings` originally provisioned CloudFront legacy (v1) standard
logs: tab-delimited gzip text files delivered to an S3 bucket, with a Glue table over
them (LazySimpleSerDe) and an Athena workgroup for querying.

The v1 format has three properties that make it expensive and slow to analyze at scale:

- **Row-oriented text.** Every query scans the full width of all 33 columns, even when
  only a handful are needed. Athena bills on bytes scanned, so wide text is costly.
- **No native partitioning.** Objects land in a flat prefix with no Hive-style
  partition structure, so Athena cannot prune by time without a crawler or `MSCK REPAIR`
  maintaining partitions.
- **All columns always present.** There is no way to narrow the delivered fields to the
  ones the analytics processor actually consumes.

CloudFront standard logging v2 (delivered through CloudWatch Logs deliveries:
`CfnDeliverySource` / `CfnDeliveryDestination` / `CfnDelivery`, available in the installed
`aws-cdk-lib`) addresses all three: Apache Parquet output, Hive-compatible partition
paths, and a configurable record-field selection.

## Decision

The construct is **v2-only**. It contains no v1 code at all — the legacy tab-delimited
Glue table (TextInputFormat / HiveIgnoreKeyTextOutputFormat / LazySimpleSerDe,
`skip.header.line.count`) and the v1 sample query are fully removed.

1. Providing the optional `athena` prop provisions the entire v2 Parquet pipeline: a Glue
   database, a single Parquet Glue table (`cf_logs_table` by default — it is now THE
   table, so there is no `v2` qualifier in its name), an Athena workgroup, and an Athena
   results bucket. There is no `enabled` flag and no nested `v2` object; the presence of
   `athena` is the switch.
2. The Parquet Glue table is created over `s3://<logBucket>/<outputPrefix>/` (default
   prefix `v2`) using the Parquet input/output formats and `ParquetHiveSerDe`, with
   `year/month/day/hour` partition keys and partition-projection table parameters.
3. The field set is a single array that is both the source of truth and the default: all
   fields are captured unless `athena.recordFields` selects a subset. Each entry carries a
   normalized Glue/Athena column name (`glueName`), the CloudFront delivery field token
   (`deliveryField`), and a type. One array drives both representations:
   - **Glue table columns** use the normalized `glueName` (lowercase, hyphens folded to
     underscores, parentheses stripped — e.g. `sc_status`, `cs_user_agent`, `cs_host`).
     These match the column names the analytics processor's Athena queries reference, so
     the queries resolve. (The previous construct created hyphenated Glue column names
     that the processor's normalized queries could not resolve — a real bug this fixes.)
   - **Delivery `recordFields`** use the CloudFront field tokens the delivery API accepts
     (e.g. `sc-status`, `cs-user-agent`, `cs(Host)`, `timestamp`).
     Numeric columns are typed (`sc_status` int; `sc_bytes`/`cs_bytes`/`sc_content_len`/
     `sc_range_start`/`sc_range_end` bigint; `time_taken`/`time_to_first_byte` double);
     everything else is string.
4. `enableV2Logging({ distributionArn })` wires the delivery pipeline:
   `CfnDeliverySource` (`logType: "ACCESS_LOGS"`, the distribution ARN),
   `CfnDeliveryDestination` (the log bucket ARN, `outputFormat: "parquet"`), and
   `CfnDelivery` (`s3EnableHiveCompatiblePath: true`, an `<outputPrefix>/...` suffix path,
   and `recordFields` derived from the selected fields' delivery tokens). The method exists
   instead of a constructor prop to break the cyclic dependency: the distribution needs
   `cloudFrontLoggingSettings`, and the delivery source needs the distribution ARN, which
   only exists once the consumer has constructed the distribution.
5. `cloudFrontLoggingSettings` sets `enableLogging: false` (no `logBucket`/`logFilePrefix`):
   v2 delivery writes to the bucket directly through the CloudWatch Logs delivery, not
   through the distribution's own logging config.
6. Public readonly members — `logBucket`, `athenaResultsBucket`, `glueDatabaseName`,
   `glueTableName`, `workgroupName` — let a consuming stack wire these into the analytics
   processor. There is no `glueV1TableName`.

## Rationale

### 1. Parquet + field selection → cheaper, faster Athena

Columnar Parquet lets Athena read only the referenced columns, and selecting a subset via
`recordFields` delivers only the fields a consumer needs. The analytics processor needs
ten of the fields and exports them as `requiredRecordFields`; passing that as
`recordFields` shrinks the Parquet objects and the bytes Athena scans, which is what
Athena bills on.

### 2. Normalized column names → downstream queries resolve

Glue columns use normalized names (lowercase, hyphen→underscore, parentheses stripped) so
the analytics processor's `columnMaps.v2` references (`sc_status`, `sc_bytes`, `cs_bytes`,
`time_taken`, `x_edge_result_type`, `x_edge_detailed_result_type`, `cs_uri_stem`, `c_ip`,
`cs_user_agent`, `timestamp`) resolve without quoting or casting.

### 3. Partition projection → no crawler, no MSCK

The table declares `year/month/day/hour` partition keys and enables Athena partition
projection via table parameters (`projection.enabled=true`, per-key integer type/range/
digits, and a `storage.location.template` matching the Hive path). Athena computes
partitions from the query predicate at plan time, so no Glue crawler or `MSCK REPAIR` is
needed and any hour becomes queryable the instant its objects are delivered.

## Consequences

Positive:

- Analytics queries scan far fewer bytes (columnar + selected fields + partition pruning).
- Any hour is queryable immediately with no partition-maintenance job.
- Normalized Glue column names resolve directly against the processor's queries.
- Far less code: no dual-table/dual-format branching, no getters (public members instead).

Negative / trade-offs:

- **Breaking change.** The `athena` prop shape changed (flat, no nested `v2`/`enabled`),
  the Glue table default name changed (`cf_logs_table`, Parquet), the Glue column names
  changed (normalized), and the getters became public members (`glueTableName` replaces
  `glueV2TableName`; `glueV1TableName` is gone). This is acceptable: `@beesolve/cdk-constructs`
  is 0.x and consumed only internally. No compatibility shim is provided.
- A pre-existing v1 deployment needs a one-time, operator-run manual migration to orphan
  the old v1 Glue/bucket resources (so historic data survives for backfill) before
  deploying the v2-only construct. See
  [how-to/migrate-v1-to-v2-logging.md](./how-to/migrate-v1-to-v2-logging.md).
- Partition-projection ranges are bounded (`year` 2020–2100); they must be widened if the
  deployment outlives that window.

## Alternatives Considered

### Keep v1 alongside v2 in the construct

Rejected. Carrying both formats meant dual Glue tables, dual sample queries, and a
nested `v2.enabled` toggle — more surface area for a format we no longer collect. Since
the library is 0.x and internal-only, a clean v2-only construct with a documented one-time
migration is simpler than preserving v1 forever. The v1 history is retained operationally
(orphaned resources + the backfill), not by the construct.

### Keep hyphenated Glue column names

Rejected. The processor normalizes column names (lowercase, hyphen→underscore) in its
queries; hyphenated Glue columns would not resolve. Normalizing in the construct is the
fix, and it keeps the Glue schema aligned with the one representation the processor uses.

### A `distributionArn` constructor prop instead of `enableV2Logging`

Rejected: the distribution is constructed by the consumer **using**
`cloudFrontLoggingSettings`, so its ARN does not exist when this construct is built.
Passing it in the constructor would force a cyclic dependency. A method called after the
distribution exists avoids it.

## Notes

CloudFront access logs contain no viewer-country field. Country must be derived downstream
from the client IP (`c_ip`); it is intentionally not a distinct record field.
