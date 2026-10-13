---
"@beesolve/cdk-constructs": minor
---

Fix the CloudFront standard logging v2 Parquet Glue table so Athena queries return rows.

The Glue table's `location` and partition projection no longer point at `s3://<bucket>/v2/`
with `year/month/day/hour` partitions. CloudWatch Logs vended delivery automatically prepends
`AWSLogs/aws-account-id=<account>/CloudFront/` to the configured suffix and, in
Hive-compatible mode, writes `key=value` partition segments. The table now matches the real
delivered layout:

```
s3://<bucket>/AWSLogs/aws-account-id=<account>/CloudFront/<outputPrefix>/DistributionId=<dist>/year=YYYY/month=MM/day=DD/hour=HH/<file>.parquet
```

A `distributionid` partition is added ahead of `year/month/day/hour` and projected as a
single-value `enum`, so queries that filter only by `year/month/day/hour` (as the analytics
processor does) resolve without needing a `DistributionId` predicate. Because the distribution
id is only known once `enableV2Logging({ distributionArn })` is called, the
distribution-id-dependent partitioning (the `distributionid` enum values and the
`storage.location.template`) is finalized there rather than in the constructor.

The delivery `s3SuffixPath` is unchanged: `v2/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}` already
resolves to the correct keys once CloudWatch Logs prepends the fixed prefix and Hive mode adds
the `key=` segments. Only the Glue table was wrong.
