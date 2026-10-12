# How to: Get started with the analytics dashboard

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/analytics

## Prerequisites

- A CloudFront distribution logged by `@beesolve/cdk-constructs` `CloudFrontAccessLoggingSettings` with standard logging v2 enabled
- A deployed `@beesolve/analytics-processor` (the dashboard reads its DynamoDB table)
- `@beesolve/auth-service` for email-code sign-in
- A CDK app (`aws-cdk-lib` + `constructs`), SES configured in the region

## Steps

### 1. Install

```sh
bun add @beesolve/analytics-dashboard @beesolve/analytics-processor @beesolve/cdk-constructs @beesolve/auth-service
```

```sh
npm install @beesolve/analytics-dashboard @beesolve/analytics-processor @beesolve/cdk-constructs @beesolve/auth-service
```

### 2. Wire logging → processor → dashboard

Only `./cdk` is exported. Log the distribution as Parquet (v2), aggregate it with the
processor, then pass the processor and auth to `AnalyticsDashboard`. `FRONTEND_URI` is the
CloudFront URL of the dashboard.

```ts
import { AnalyticsDashboard } from "@beesolve/analytics-dashboard/cdk";
import { requiredRecordFields } from "@beesolve/analytics-processor";
import { AnalyticsProcessor } from "@beesolve/analytics-processor/cdk";
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { CloudFrontAccessLoggingSettings } from "@beesolve/cdk-constructs";

const logging = new CloudFrontAccessLoggingSettings(stack, "Logging", {
  athena: { account: "123456789012", recordFields: requiredRecordFields },
});

// create your CloudFront `distribution`, spreading
// `...logging.cloudFrontLoggingSettings` into its props, then wire v2 delivery:
logging.enableV2Logging({
  distributionArn: `arn:aws:cloudfront::123456789012:distribution/${distribution.distributionId}`,
});

const processor = new AnalyticsProcessor(stack, "Processor", {
  athenaDatabase: logging.glueDatabaseName!,
  athenaV2Table: logging.glueTableName!,
  athenaWorkgroup: logging.workgroupName!,
  logBucketArn: logging.logBucket.bucketArn,
  athenaResultsBucketArn: logging.athenaResultsBucket?.bucketArn,
});

const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri: process.env.FRONTEND_URI!,
  allowSignUp: false,
  authorizerCache: "disabled",
});

new AnalyticsDashboard(stack, "AnalyticsDashboard", {
  auth,
  processor,
  emailSender: { name: "Analytics Dashboard", emailAddress: "noreply@example.com" },
});
```

### 3. First deploy (chicken-and-egg `FRONTEND_URI`)

The SvelteKit build needs the CloudFront URL, which does not exist until the first deploy:

1. Set `FRONTEND_URI` to a placeholder URL (e.g. `https://placeholder.cloudfront.net`).
2. Deploy — note the CloudFront URL from the CDK output.
3. Update `FRONTEND_URI` with the real URL and **redeploy**.

```sh
bunx cdk deploy
```

### 4. Backfill historic data (one-time, operator-run)

v2 Parquet collection only begins once the upgraded logging construct is deployed. Historic
traffic is in the already-collected v1 (tab-delimited) logs. Run the one-time backfill from
`@beesolve/analytics-processor` once, with AWS credentials in scope, so long-range views have
data:

```sh
# from the analytics-processor package
bun run backfill -- --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z
```

The backfill walks the historic hour range through the same write path as the hourly Lambda. It
is resumable and exactly-once (per-hour idempotency markers), so re-running skips hours already
processed. Pass `--rollups` to also build daily/monthly aggregates over the backfilled range.

## Common Pitfalls

- First deploy is chicken-and-egg: set `FRONTEND_URI` to a placeholder, deploy, then redeploy
  with the real CloudFront URL.
- The dashboard renders no history until the one-time `bun run backfill` has populated the table
  from v1 logs; ongoing hours fill automatically on the hourly schedule (with a ~2h processing
  lag for v2 delivery).
- Country columns show `ZZ` for IPs that cannot be resolved and are blank entirely unless the
  processor was given an ipinfo API key.

## See Also

- [README](../../README.md) — architecture, construct props, local development
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/analytics)
