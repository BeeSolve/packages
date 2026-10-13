---
"@beesolve/analytics-processor": patch
---

Grant the hourly processor Lambda `s3:GetBucketLocation` and `s3:ListBucket` on the Athena
results bucket (in addition to `s3:PutObject`/`s3:GetObject`). Athena verifies the output
bucket before running a query, and without these actions `StartQueryExecution` fails with
`InvalidRequestException: Unable to verify/create output bucket ... (INSUFFICIENT_PERMISSIONS)`,
so every hourly run errored and no analytics data was ever written to DynamoDB.
