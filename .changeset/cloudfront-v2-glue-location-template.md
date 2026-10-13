---
"@beesolve/cdk-constructs": minor
---

The v2 Parquet Glue table for CloudFront standard logging v2 no longer declares
`distributionid` as a partition column. In 0.7.0 it was declared as a partition
projected as a single-value `enum`, but the `storage.location.template` embedded
a literal `DistributionId=<dist>` path segment instead of a `${distributionid}`
placeholder. Athena requires the location template to contain a template for
every partition column, so it rejected queries against the table with:
`INVALID_TABLE_PROPERTY: The 'storage.location.template' table property must
contain templates for all partition columns!`.

Because each log bucket/prefix holds the access logs for exactly one
distribution, the distribution id is now baked into the table
`StorageDescriptor.Location` and `storage.location.template` as a literal
`DistributionId=<dist>/` path segment rather than being a partition. That leaves
only `year/month/day/hour` as the projected partition columns, which Athena
accepts and which lets the analytics processor's year/month/day/hour-only
queries resolve against the table.
