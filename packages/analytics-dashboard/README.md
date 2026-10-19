# @beesolve/analytics-dashboard

SvelteKit dashboard for viewing CloudFront traffic analytics — deployed on AWS Lambda behind CloudFront with email-code authentication.

> [!WARNING]
> **Pre-1.0 — unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

## Architecture

```
┌────────────┐     ┌──────────────┐     ┌─────────┐     ┌──────────┐
│ CloudFront │ ──► │ Lambda (SSR) │ ──► │ DynamoDB│     │   SES    │
└────────────┘     └──────────────┘     └─────────┘     └──────────┘
       │                     ▲                                ▲
       │          read-only  │ analytics table                │
       │          (AnalyticsProcessor.grantRead)      OTP emails via
       └── /auth/* ──► AuthGateway (authorizer)       @beesolve/email-service
```

The dashboard reads the `@beesolve/analytics-processor` DynamoDB table (hourly/daily/monthly
totals + per-dimension breakdowns) **read-only**. Its own small DynamoDB table holds the
dashboard's `Users`/`Setup` records (sign-in, roles).

## Prerequisites

```bash
npm install \
  @beesolve/analytics-dashboard \
  @beesolve/analytics-processor \
  @beesolve/cdk-constructs \
  @beesolve/auth-service \
  aws-cdk \
  aws-cdk-lib \
  constructs
```

- [`@beesolve/cdk-constructs`](../cdk-constructs) — `CloudFrontAccessLoggingSettings` with standard logging v2
- [`@beesolve/analytics-processor`](../analytics-processor) — aggregates Athena query results into DynamoDB
- [`@beesolve/auth-service`](../service-auth) — email-code authentication with session management

## CDK Setup

```typescript
import { AnalyticsDashboard } from "@beesolve/analytics-dashboard/cdk";
import { requiredRecordFields } from "@beesolve/analytics-processor";
import { AnalyticsProcessor } from "@beesolve/analytics-processor/cdk";
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { CloudFrontAccessLoggingSettings } from "@beesolve/cdk-constructs";
import { App, RemovalPolicy, Stack } from "aws-cdk-lib";

const frontendUri = process.env.FRONTEND_URI;
if (frontendUri == null) throw new Error("FRONTEND_URI environment variable is required");

const app = new App();
const stack = new Stack(app, "AnalyticsStack", {
  env: { account: "123456789012", region: "eu-central-1" },
});

// 1. Log the distribution to S3 as Parquet (standard logging v2)
const logging = new CloudFrontAccessLoggingSettings(stack, "Logging", {
  athena: { account: "123456789012", recordFields: requiredRecordFields },
});

// ...create your CloudFront `distribution`, spreading
// `...logging.cloudFrontLoggingSettings` into its props, then:
logging.enableV2Logging({
  distributionArn: `arn:aws:cloudfront::123456789012:distribution/${distribution.distributionId}`,
});

// 2. Aggregate logs into DynamoDB
const processor = new AnalyticsProcessor(stack, "Processor", {
  athenaDatabase: logging.glueDatabaseName!,
  athenaV2Table: logging.glueTableName!,
  athenaWorkgroup: logging.workgroupName!,
  logBucketArn: logging.logBucket.bucketArn,
  athenaResultsBucketArn: logging.athenaResultsBucket?.bucketArn,
});

// 3. Set up authentication
const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: false,
  authorizerCache: "disabled",
});

// 4. Deploy the dashboard
const dashboard = new AnalyticsDashboard(stack, "AnalyticsDashboard", {
  auth,
  processor,
  emailSender: {
    name: "Analytics Dashboard",
    emailAddress: "noreply@example.com",
  },
});
```

The `AnalyticsDashboard` construct provisions:

- SvelteKit app on Lambda (via `kit-on-lambda`)
- CloudFront distribution with auth cookie enforcement
- Auth behavior for `/auth/*` routes
- A dedicated DynamoDB table (+ reverse GSI) for the dashboard's `Users`/`Setup`, wired via `ANALYTICS_USERS_TABLE` / `ANALYTICS_USERS_REVERSE_INDEX`
- Read-only access to the processor's analytics table via `processor.grantRead(handler)` (`ANALYTICS_TABLE_NAME` / `ANALYTICS_REVERSE_INDEX`)
- Email service for OTP codes
- EventBridge rule for auth events (sends OTP emails)

## Data layer (remote functions)

The dashboard reads its data through SvelteKit remote functions, not `+page.server.ts`
`load`/`actions`. Definitions live in `src/lib/remote/*.remote.ts`:

- `getOverview({ grain, anchor?, size? })` — clamps the window per grain, computes boundary
  keys deterministically from the anchor (no DynamoDB cursors), and returns the totals series
  plus `prev`/`next` anchors.
- `getBreakdown({ dimension, grain, periodKey })` — reads a single bounded breakdown partition.
- `users`/`setup` remote functions mirror `@beesolve/dmarc-dashboard` (admin guards,
  `toRemoteError`, `requireUser`/`requireAdmin`).

Environment variables are declared in `src/env.ts` via `defineEnvVars` (Valibot schemas) and
imported, typed and validated, from `$app/env/private`: `ANALYTICS_TABLE_NAME`,
`ANALYTICS_REVERSE_INDEX`, `ANALYTICS_USERS_TABLE`, `ANALYTICS_USERS_REVERSE_INDEX`.

## First Deployment

The SvelteKit build requires a `FRONTEND_URI` environment variable (the CloudFront URL), which doesn't exist until after the first deploy:

1. Set `FRONTEND_URI` to a placeholder URL (e.g. `https://placeholder.cloudfront.net`)
2. Deploy — note the CloudFront URL from CDK output
3. Update `FRONTEND_URI` with the real URL and redeploy

## Backfilling history

CloudFront standard logging v2 only starts collecting Parquet data once the upgraded
`CloudFrontAccessLoggingSettings` is deployed. Historic traffic lives in the already-collected
v1 (tab-delimited) logs. Run the one-time backfill from `@beesolve/analytics-processor` once,
as an operator, to populate the table from v1 history before anyone relies on long-range views:

```bash
# from the analytics-processor package, with AWS creds (AWS_PROFILE) in scope
bun run backfill -- --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z
```

The backfill is resumable and exactly-once (per-hour idempotency markers), so re-running it
skips already-processed hours. See the processor README for the full flag reference.

## Local Development

Run the SvelteKit dev server against the **real** deployed backend — no fixtures:

```bash
bun install
cp .env.local.example .env.local   # then fill in real values
aws sso login                      # (or export AWS_PROFILE) so SDK clients can reach AWS
bun run dev
```

There is no Lambda authorizer locally, so `@beesolve/auth-service` injects a dev session
automatically. Set `DEV_USER_EMAIL` in `.env.local` to a **real** user's email in the users
table — the app looks it up to resolve that user's role. This is guarded by `import.meta.env.DEV`
and never included in the deployed bundle.

## Features

- Overview with hourly/daily/monthly/yearly grain switching and rolling prev/next windows
- Stat cards for hits, success, errors, and bytes
- Per-dimension breakdowns: HTTP status, country, device, and top paths
- Email-code sign-in (no passwords) + user management (invite, remove)

## License

[MIT](../../LICENSE)
