---
"@beesolve/analytics-processor": minor
---

Export `requiredRecordFields`: the 10 normalized CloudFront log column names the hourly
processor reads. Pass it as `CloudFrontAccessLoggingSettings`' `athena.recordFields` to
deliver only the fields the processor needs, shrinking the Parquet objects and cutting
Athena scan cost. See `docs/how-to/reduce-athena-cost.md`.
