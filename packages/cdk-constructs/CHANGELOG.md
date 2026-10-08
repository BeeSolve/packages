# @beesolve/cdk-constructs

## 0.3.3

### Patch Changes

- 28c8608: Stop `tagFunctionsWithRevision` from propagating the `revision` tag to child constructs.

  `Tags.of(fn).add("revision", ...)` propagated the tag to every taggable construct nested under each Lambda function (SQS queues, DLQs, SNS topics, CloudWatch alarms, IAM roles). Because `revision` changes on every commit, CloudFormation issued an in-place `UPDATE` on all of those resources on every deploy, making deploys slow and noisy even when nothing functional changed.

  The aspect now restricts the tag to `AWS::Lambda::Function` resources via `includeResourceTypes`, so only the functions carry the changing `revision` tag. No public API change.

## 0.3.2

### Patch Changes

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

- Updated dependencies [b9e6f26]
  - @beesolve/helpers@0.2.1

## 0.3.1

### Patch Changes

- Updated dependencies [f02c1a4]
  - @beesolve/helpers@0.2.0

## 0.3.0

### Minor Changes

- d54dca7: Add `CfnOutput` with the CloudFront distribution URL to `StaticWebsite` construct. The URL is output as `DistributionUrl` after deployment.

## 0.2.2

### Patch Changes

- f9b9ddb: fix cdk deprecation notice

## 0.2.1

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects

## 0.2.0

### Minor Changes

- c2bd8aa: Add optional `encryptionKey` prop for customer-managed KMS encryption on all data-at-rest resources (DynamoDB tables and SQS queues).

  **@beesolve/cdk-constructs**

  - `SqsWithDlq`: add `encryptionKey?: IKey` — uses KMS encryption when provided
  - `Nodejs24Function`: add VPC + DynamoDB Gateway Endpoint documentation

  **@beesolve/sqs-handler**

  - `SqsHandler`: add `encryptionKey?: IKey` — forwarded to SQS queues

  **@beesolve/action-tokens**

  - Add `encryptionKey?: IKey` for customer-managed table encryption
  - Add `contributorInsights?: boolean` for CloudWatch Contributor Insights
  - Default `deletionProtection` to `true` when `removalPolicy` is `RETAIN`
  - Default `pointInTimeRecoveryEnabled` to `true` when `deletionProtection` is `true`

  **@beesolve/auth-service**

  - Add `encryptionKey?: IKey` applied to all tables and SQS queues
  - Add `contributorInsights?: boolean` (default `true` in prod)
  - Add `accessLogging?: boolean` for HTTP API access logs (default `true` in prod)
  - Add `authorizerReservedConcurrency?: number`
  - Add `sdkHandlerReservedConcurrency?: number`
  - Add CDK warning when `alarms` is not provided

## 0.1.30

### Patch Changes

- 9ac7256: Fix handler name parsing in `Nodejs24Function` to use `path.basename`/`path.extname` instead of fragile string splitting. Export `parseHandlerName` for standalone use.

  Add `refererId` validation in `StaticWebsite` — throws on empty strings or wildcards to prevent unintended S3 access.

  Emit a CDK warning in `SqsWithDlq.asLambdaInput` when the visibility timeout is silently capped at 12 hours.

  Add tests for all four constructs (33 tests). Add `bun test` script. Expand README with usage examples for all exports.

## 0.1.29

### Patch Changes

- 63dac16: fix credential injection in StaticWebsite basic auth CloudFront function
- Updated dependencies [5abe822]
  - @beesolve/helpers@0.1.5
