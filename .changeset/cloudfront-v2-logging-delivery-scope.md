---
"@beesolve/cdk-constructs": minor
---

`CloudFrontAccessLoggingSettings.enableV2Logging` now accepts an optional `deliveryScope`
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
