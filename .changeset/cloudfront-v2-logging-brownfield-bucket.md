---
"@beesolve/cdk-constructs": minor
---

`CloudFrontAccessLoggingSettings.enableV2Logging` now accepts an optional `logBucketArn`
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
