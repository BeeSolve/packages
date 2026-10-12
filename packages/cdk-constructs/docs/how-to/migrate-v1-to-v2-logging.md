# How to: Migrate from legacy (v1) to standard logging v2

> One-time, operator-run migration for a project you own. Run it once, by hand.

`CloudFrontAccessLoggingSettings` is now **v2-only**: it provisions a single Parquet Glue
table over standard logging v2 and contains no legacy (v1) code. If you already deployed an
older version that created the v1 tab-delimited Glue table, this is a **breaking, one-way**
migration. There is no automatic cutover — collection switches to v2 Parquet on deploy, and
at most a seam hour of data is lost at the switch.

The goal of the migration is to keep your already-collected v1 S3 objects (and a v1 Glue
table over them) queryable so the analytics processor's one-time backfill can read them,
while CloudFormation stops managing those resources.

## Prerequisites

- You own the stack and the AWS account.
- You know the current v1 Glue database name, v1 Glue table name, Athena workgroup name,
  and the log bucket name from the deployed stack.

## Steps

### 1. Orphan the existing v1 resources

Before deploying the new construct, stop CloudFormation from deleting the v1 Glue
database/table, Athena workgroup, and the log bucket, so the historic v1 S3 objects and a
v1 Glue table over them survive for the backfill.

Apply a `RETAIN` removal policy to (or import out of the stack) the v1 Glue table,
database, workgroup, and the log bucket, then deploy that orphaning change on its own. In
CDK terms, add `applyRemovalPolicy(RemovalPolicy.RETAIN)` to the old resources (or remove
them from the stack with a retain policy) and deploy.

After this step the v1 Glue table and the v1 S3 objects still exist in AWS but are no
longer managed by the stack.

### 2. Deploy the v2-only construct

Replace the old construct usage with the new API and deploy:

```ts
import { requiredRecordFields } from "@beesolve/analytics-processor";
import { CloudFrontAccessLoggingSettings } from "@beesolve/cdk-constructs";

const logging = new CloudFrontAccessLoggingSettings(this, "Logging", {
  athena: { account, recordFields: requiredRecordFields },
});
```

This creates a new Parquet Glue table (`cf_logs_table` by default) over the `/v2/` prefix
in the **same** log bucket. v2 objects land under `/v2/`; the historic v1 objects under the
old prefix are untouched.

### 3. Enable v2 delivery after the distribution exists

```ts
const distribution = new Distribution(this, "Distribution", {
  defaultBehavior: { origin: new HttpOrigin("example.com") },
  ...logging.cloudFrontLoggingSettings,
});

logging.enableV2Logging({
  distributionArn: `arn:aws:cloudfront::${account}:distribution/${distribution.distributionId}`,
});
```

### 4. Backfill from the retained v1 table (once)

Run the analytics processor's one-time backfill against the **retained** v1 Glue table and
log bucket. These are supplied manually to the backfill (the v2-only construct no longer
exposes a v1 table) — pass the v1 database/table/workgroup you orphaned in step 1:

```sh
ATHENA_DATABASE=<v1 db> \
ATHENA_V1_TABLE=<retained v1 table> \
ATHENA_WORKGROUP=<workgroup> \
TABLE_NAME=<analytics table> \
bun run --filter @beesolve/analytics-processor backfill
```

The backfill reads the frozen v1 dataset once and writes the historic rollups into
DynamoDB. From here on, the hourly processor reads the v2 Parquet table.

## Notes

- This is a one-way migration. Keep the retained v1 resources only as long as you need the
  backfill; delete them manually afterwards.
- Because the library is 0.x and internal-only, no compatibility shim is provided — the
  old `athena.v2.enabled` prop shape and the `glueV1TableName`/`glueV2TableName` getters no
  longer exist.
