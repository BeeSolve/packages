# @beesolve/cdk-constructs

## 0.6.0

### Minor Changes

- 09efb63: `CloudFrontAccessLoggingSettings.enableV2Logging` now accepts an optional `logBucketArn`
  string, and the log bucket no longer forces a physical name by default.

  In 0.5.0 the log bucket was given `PhysicalName.GENERATE_IF_NEEDED` so the v2 delivery
  destination could reference it from a cross-region `deliveryScope`. That broke brownfield
  upgrades: a log bucket deployed by an earlier version without an explicit `BucketName` has a
  CloudFormation auto-assigned name, and emitting any `BucketName` (generated or pinned via
  `logBucketName`) onto an existing unnamed bucket forces a replacement — which fails outright on
  a retained bucket (`CloudFormation cannot update a stack when a custom-named resource requires
  replacing`).

  The fix decouples the delivery destination from the construct's bucket object:

  - The log bucket now sets `BucketName` **only** when `logBucketName` is explicitly provided
    (a greenfield opt-in). When omitted, no `BucketName` is emitted, so an existing unnamed
    bucket is reused in place and never replaced. The `PhysicalName.GENERATE_IF_NEEDED` default
    from 0.5.0 is reverted.
  - `enableV2Logging` accepts `logBucketArn?: string`. When set, the `CfnDeliveryDestination`
    uses that literal ARN instead of `this.logBucket.bucketArn`, so no cross-stack reference to
    the bucket object is created (that reference is what previously forced a bucket name). Pass a
    deterministic ARN (e.g. `arn:aws:s3:::my-existing-bucket`) when the log bucket lives in a
    different stack/region than `deliveryScope`.

  Brownfield recipe: leave `logBucketName` unset and pass
  `enableV2Logging({ distributionArn, deliveryScope, logBucketArn: 'arn:aws:s3:::<bucket>' })`.

## 0.5.0

### Minor Changes

- b868372: `CloudFrontAccessLoggingSettings.enableV2Logging` now accepts an optional `deliveryScope`
  construct. CloudFront standard logging v2 requires the CloudWatch Logs vended-delivery
  resources (`CfnDeliverySource`, `CfnDeliveryDestination`, `CfnDelivery`) to be created in
  `us-east-1` — the CloudWatch API rejects `PutDeliverySource` for this log type in any other
  region. Previously these resources were always scoped to the construct, so a consumer
  deploying in a non-us-east-1 region (e.g. `eu-central-1`) hit a deploy failure:
  `PutDeliverySource action is not supported for this LogType in region eu-central-1`.

  Pass a us-east-1 stack as `deliveryScope` to create the delivery trio there while keeping the
  log bucket and everything else in the home region. The delivery destination references the
  (possibly cross-region) log bucket ARN as a plain string, so cross-region delivery works.

  This is backward compatible: `deliveryScope` defaults to `this`, so existing callers in
  us-east-1 are unaffected.

  Also adds an optional `logBucketName` prop to `CloudFrontAccessLoggingSettingsProps` that
  sets the access-log bucket's physical name explicitly. The log bucket now uses
  `PhysicalName.GENERATE_IF_NEEDED`, which materializes a CDK-generated name once the bucket
  is referenced cross-stack. For a brownfield consumer whose already-deployed log bucket has a
  CloudFormation auto-assigned name (no explicit `BucketName`), emitting a different generated
  name would force a replacement of the bucket — and a bucket name is immutable. Pass the
  existing physical bucket name via `logBucketName` to pin it so the upgrade is a no-op on the
  bucket (no replacement, no loss of retained v1 data). It is also usable to control the bucket
  name for cross-region v2 delivery. When omitted it defaults to
  `PhysicalName.GENERATE_IF_NEEDED`, preserving existing greenfield behavior.

## 0.4.0

### Minor Changes

- 029b8eb: Make `CloudFrontAccessLoggingSettings` CloudFront standard logging v2 (Parquet) only.

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

## 0.3.3

### Patch Changes

- 28c8608: Stop `tagFunctionsWithRevision` from propagating the `revision` tag to child constructs.

  `Tags.of(fn).add("revision", ...)` propagated the tag to every taggable construct nested under each Lambda function (SQS queues, DLQs, SNS topics, CloudWatch alarms, IAM roles). Because `revision` changes on every commit, CloudFormation issued an in-place `UPDATE` on all of those resources on every deploy, making deploys slow and noisy even when nothing functional changed.

  The aspect now restricts the tag to `AWS::Lambda::Function` resources via `includeResourceTypes`, so only the functions carry the changing `revision` tag. No public API change.

## 0.3.2

### Patch Changes

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

- Updated dependencies [b9e6f26]
  - @beesolve/helpers@0.2.1

## 0.3.1

### Patch Changes

- Updated dependencies [f02c1a4]
  - @beesolve/helpers@0.2.0

## 0.3.0

### Minor Changes

- d54dca7: Add `CfnOutput` with the CloudFront distribution URL to `StaticWebsite` construct. The URL is output as `DistributionUrl` after deployment.

## 0.2.2

### Patch Changes

- f9b9ddb: fix cdk deprecation notice

## 0.2.1

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects

## 0.2.0

### Minor Changes

- c2bd8aa: Add optional `encryptionKey` prop for customer-managed KMS encryption on all data-at-rest resources (DynamoDB tables and SQS queues).

  **@beesolve/cdk-constructs**

  - `SqsWithDlq`: add `encryptionKey?: IKey` — uses KMS encryption when provided
  - `Nodejs24Function`: add VPC + DynamoDB Gateway Endpoint documentation

  **@beesolve/sqs-handler**

  - `SqsHandler`: add `encryptionKey?: IKey` — forwarded to SQS queues

  **@beesolve/action-tokens**

  - Add `encryptionKey?: IKey` for customer-managed table encryption
  - Add `contributorInsights?: boolean` for CloudWatch Contributor Insights
  - Default `deletionProtection` to `true` when `removalPolicy` is `RETAIN`
  - Default `pointInTimeRecoveryEnabled` to `true` when `deletionProtection` is `true`

  **@beesolve/auth-service**

  - Add `encryptionKey?: IKey` applied to all tables and SQS queues
  - Add `contributorInsights?: boolean` (default `true` in prod)
  - Add `accessLogging?: boolean` for HTTP API access logs (default `true` in prod)
  - Add `authorizerReservedConcurrency?: number`
  - Add `sdkHandlerReservedConcurrency?: number`
  - Add CDK warning when `alarms` is not provided

## 0.1.30

### Patch Changes

- 9ac7256: Fix handler name parsing in `Nodejs24Function` to use `path.basename`/`path.extname` instead of fragile string splitting. Export `parseHandlerName` for standalone use.

  Add `refererId` validation in `StaticWebsite` — throws on empty strings or wildcards to prevent unintended S3 access.

  Emit a CDK warning in `SqsWithDlq.asLambdaInput` when the visibility timeout is silently capped at 12 hours.

  Add tests for all four constructs (33 tests). Add `bun test` script. Expand README with usage examples for all exports.

## 0.1.29

### Patch Changes

- 63dac16: fix credential injection in StaticWebsite basic auth CloudFront function
- Updated dependencies [5abe822]
  - @beesolve/helpers@0.1.5
