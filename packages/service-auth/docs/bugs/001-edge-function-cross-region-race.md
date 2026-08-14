# BUG-001: EdgeFunction cross-region race condition on first deployment

## Status: Open (workaround: deploy twice with --no-rollback)

## Date Discovered: 2026-08-13

## Component

`AuthGateway` / `AuthService` CDK constructs — specifically the `experimental.EdgeFunction` used for `edgeBodyHash` (POST body SHA256 signing for OAC).

## Symptom

On first deployment of any stack using `AuthGateway` to a non-`us-east-1` region, CloudFormation fails with:

```
CREATE_FAILED | Custom::CrossRegionStringParameterReader | AuthEdgeBodyHashArnReaderBB385AEA
ParameterNotFound: UnknownError
```

The `ArnReader` custom resource tries to read an SSM parameter in `us-east-1` that hasn't been written yet.

## Root Cause

CDK's `experimental.EdgeFunction` deploys Lambda@Edge functions via a cross-region mechanism:

1. A nested stack in `us-east-1` creates the Lambda function
2. After creation, the nested stack writes the function ARN to an SSM parameter in `us-east-1`
3. A `CrossRegionStringParameterReader` custom resource in the deploying region (`eu-central-1`) reads that SSM parameter

On first deployment, CloudFormation processes the nested stack creation (step 1-2) and the parameter reader (step 3) in parallel. The reader executes before the writer has finished creating the Lambda and writing the SSM parameter — resulting in `ParameterNotFound`.

This is a known limitation of CDK's `experimental.EdgeFunction` pattern. Subsequent deployments work because the SSM parameter persists from the first (failed) attempt.

## Affected Stacks

Any stack that uses `AuthGateway` or `AuthService` and deploys from a region other than `us-east-1`. This includes:

- `SamplesDmarcReports`
- `SamplesAuthEmailAuthorizer`
- Any consumer stack using the auth behavior pattern

Stacks deployed to `us-east-1` are unaffected (no cross-region deployment needed).

## Workaround (current)

Deploy twice with `--no-rollback` on the first attempt:

```bash
# First deploy — will fail but --no-rollback preserves the cross-region resources
bun run cdk deploy <StackName> --require-approval never --no-rollback

# Second deploy — succeeds because SSM parameter now exists
bun run cdk deploy <StackName> --require-approval never
```

The `--no-rollback` flag prevents CloudFormation from deleting the nested stack in `us-east-1` on failure. The nested stack successfully creates the Lambda and writes the SSM parameter, but the main stack rolls back the reader. On the second deployment, the SSM parameter exists and the reader succeeds.

## Why existing stacks work

Stacks that were previously deployed successfully (like `SamplesAuthEmailAuthorizer`) work because:

- The SSM parameter in `us-east-1` persists across deployments
- Updates to existing stacks find the parameter already present
- Only fresh/first deployments of new stacks hit the race condition

## Potential Fixes

### Option A: Replace `experimental.EdgeFunction` with manual cross-region deployment

Deploy the Lambda@Edge function via a separate CDK stack in `us-east-1` that is deployed first, then reference its ARN in the main stack. This eliminates the race but adds deployment complexity.

### Option B: Add retry logic to the ArnReader custom resource

Modify the custom resource Lambda to retry with exponential backoff when `ParameterNotFound` is returned. The SSM parameter typically appears within 30-60 seconds of the nested stack starting.

### Option C: Use `aws-cdk-lib/aws-cloudfront` non-experimental EdgeFunction

Newer CDK versions may have improved the dependency chain. Investigate if the non-experimental `EdgeFunction` (if available) handles the ordering correctly.

### Option D: Deploy EdgeFunction stack as a prerequisite

Split the auth construct so the EdgeFunction is created in a separate prerequisite stack that deploys first.

## Monitoring Action

### When to retry

- After CDK releases a fix for cross-region EdgeFunction dependency ordering
- After `experimental.EdgeFunction` is promoted to stable with improved behavior

### Test procedure

1. Delete the test stack completely
2. Deploy fresh without `--no-rollback`
3. If it succeeds on first attempt, the bug is fixed

## Upstream

This is a CDK framework limitation. The `experimental.EdgeFunction` construct doesn't properly establish a CloudFormation dependency between the cross-region nested stack and the `CrossRegionStringParameterReader` custom resource.

Related CDK issues:

- https://github.com/aws/aws-cdk/issues/cross-region EdgeFunction timing
