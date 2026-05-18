---
"@beesolve/cdk-constructs": patch
---

Fix handler name parsing in `Nodejs24Function` to use `path.basename`/`path.extname` instead of fragile string splitting. Export `parseHandlerName` for standalone use.

Add `refererId` validation in `StaticWebsite` — throws on empty strings or wildcards to prevent unintended S3 access.

Emit a CDK warning in `SqsWithDlq.asLambdaInput` when the visibility timeout is silently capped at 12 hours.

Add tests for all four constructs (33 tests). Add `bun test` script. Expand README with usage examples for all exports.
