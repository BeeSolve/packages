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

- [`@beesolve/dmarc-reports`](../dmarc-reports) — ingests DMARC emails into EventBridge
- [`@beesolve/dmarc-consumer`](../dmarc-consumer) — persists reports to DynamoDB
- [`@beesolve/auth-service`](../service-auth) — email-code authentication with session management

## CDK Setup

```typescript
import { DmarcDashboard } from "@beesolve/dmarc-dashboard/cdk";
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";
import { DmarcReports } from "@beesolve/dmarc-reports/cdk";
import { AuthGateway } from "@beesolve/auth-service/cdk";

// 1. Set up report ingestion
const dmarcReports = new DmarcReports(this, "DmarcReports", {
  recipient: "rua@dmarc.example.com",
});

// 2. Set up consumer (persists to DynamoDB)
const consumer = new DmarcConsumer(this, "DmarcConsumer");

// 3. Set up authentication
const auth = new AuthGateway(this, "Auth", {/* ... */});

// 4. Deploy the dashboard
const dashboard = new DmarcDashboard(this, "DmarcDashboard", {
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

The SvelteKit build requires environment variables that reference the CloudFront URL, which doesn't exist until after the first deploy:

1. Set a placeholder `FRONTEND_URI` in `mise.toml`
2. Deploy — note the CloudFront URL from CDK output
3. Update `mise.toml` with the real URL and redeploy

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
