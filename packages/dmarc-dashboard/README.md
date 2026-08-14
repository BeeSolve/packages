# @beesolve/dmarc-dashboard

SvelteKit dashboard for viewing DMARC reports — deployed on AWS Lambda behind CloudFront with email-code authentication.

## Architecture

```
┌────────────┐     ┌──────────────┐     ┌────────┐     ┌──────────┐
│ CloudFront │ ──► │ Lambda (SSR) │ ──► │ DynamoDB│     │   SES    │
└────────────┘     └──────────────┘     └─────────┘     └──────────┘
       │                                                      ▲
       └── /auth/* ──► AuthGateway (authorizer)               │
                                                    OTP emails via
                                                    @beesolve/email-service
```

## Prerequisites

```bash
npm install @beesolve/dmarc-dashboard @beesolve/dmarc-reports @beesolve/dmarc-consumer @beesolve/auth-service aws-cdk-lib constructs
```

- [`@beesolve/dmarc-reports`](../dmarc-reports) — ingests DMARC emails into EventBridge
- [`@beesolve/dmarc-consumer`](../dmarc-consumer) — persists reports to DynamoDB
- [`@beesolve/auth-service`](../service-auth) — email-code authentication with session management

## CDK Setup

```typescript
import { App, Stack } from "aws-cdk-lib";
import { DmarcDashboard } from "@beesolve/dmarc-dashboard/cdk";
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";
import { DmarcReports } from "@beesolve/dmarc-reports/cdk";
import { AuthGateway } from "@beesolve/auth-service/cdk";

const app = new App();
const stack = new Stack(app, "DmarcStack", {
  env: { account: "123456789012", region: "eu-central-1" },
});

// 1. Set up report ingestion (SES → S3 → EventBridge)
const dmarcReports = new DmarcReports(stack, "DmarcReports", {
  recipient: "rua@dmarc.example.com",
});

// 2. Set up consumer (EventBridge → SQS → Lambda → DynamoDB)
const consumer = new DmarcConsumer(stack, "DmarcConsumer");

// 3. Set up authentication
const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri: process.env.FRONTEND_URI!,
  allowSignUp: false,
});

// 4. Deploy the dashboard
const dashboard = new DmarcDashboard(stack, "DmarcDashboard", {
  auth,
  consumer,
  emailSender: {
    name: "DMARC Dashboard",
    emailAddress: "noreply@example.com",
  },
});
```

The `DmarcDashboard` construct provisions:

- SvelteKit app on Lambda (via `kit-on-lambda`)
- CloudFront distribution with auth cookie enforcement
- Auth behavior for `/auth/*` routes
- Email service for OTP codes
- EventBridge rule for auth events (sends OTP emails)

## First Deployment

The SvelteKit build requires a `FRONTEND_URI` environment variable (the CloudFront URL), which doesn't exist until after the first deploy:

1. Set `FRONTEND_URI` to a placeholder URL (e.g. `https://placeholder.cloudfront.net`)
2. Deploy — note the CloudFront URL from CDK output
3. Update `FRONTEND_URI` with the real URL and redeploy

## Local Development

```bash
bun install
bun run dev
```

Requires `DMARC_TABLE_NAME` and `DMARC_REVERSE_INDEX` environment variables pointing to a DynamoDB table (local or remote).

## Features

- Domain overview with aggregate pass/fail stats
- Per-domain report timeline with pagination
- User management (invite, remove)
- Email-code sign-in (no passwords)

## License

[MIT](../../LICENSE)
