---
"@beesolve/analytics-processor": minor
---

Let the operational commands resolve their configuration from a CloudFormation
stack. The `AnalyticsProcessor` construct now publishes its config as stack
outputs (`AnalyticsTableName`, `AnalyticsReverseIndexName`,
`AnalyticsAthenaDatabase`, `AnalyticsAthenaTable`, `AnalyticsAthenaV1Table`,
`AnalyticsAthenaWorkgroup`, `AnalyticsAthenaOutputLocation`, `AnalyticsTopPaths`,
`AnalyticsHourlyTtlDays`), and the `analytics-backfill`, `analytics-watch-backfill`,
and `analytics-compact` bins accept `--stack <name>` to read those outputs via
`cloudformation:DescribeStacks` instead of requiring every value as an
environment variable. Explicit env vars / flags still override the
stack-derived values. Adds `@aws-sdk/client-cloudformation` as a dependency.
