# @beesolve/dmarc-dashboard

SvelteKit dashboard for viewing DMARC reports — deployed on AWS Lambda behind CloudFront with email-code authentication.

## Architecture

```
┌────────────┐     ┌──────────────┐     ┌─────────┐     ┌──────────┐
│ CloudFront │ ──► │ Lambda (SSR) │ ──► │ DynamoDB│     │   SES    │
└────────────┘     └──────────────┘     └─────────┘     └──────────┘
       │                                                      ▲
       └── /auth/* ──► AuthGateway (authorizer)               │
                                                    OTP emails via
                                                    @beesolve/email-service
```

## Prerequisites

```bash
npm install \
  @beesolve/dmarc-dashboard \
  @beesolve/dmarc-reports \
  @beesolve/dmarc-consumer \
  @beesolve/auth-service \
  aws-cdk \
  aws-cdk-lib \
  constructs
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

const frontendUri = process.env.FRONTEND_URI;
if (frontendUri == null) throw new Error("FRONTEND_URI environment variable is required");

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
  frontendUri,
  allowSignUp: false,
  authorizerCache: "disabled",
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

Run the SvelteKit dev server against the **real** deployed backend — no fixtures:

```bash
bun install
cp .env.local.example .env.local   # then fill in real values
aws sso login                      # (or export AWS_PROFILE) so SDK clients can reach AWS
bun run dev
```

`bun run dev` serves on http://localhost:5173. The `dev` script runs
`bun --env-file=.env.local vite dev`, so `.env.local` is loaded into `process.env`
before the server starts, where both `hooks.server.ts` and the workspace SDK
clients read it at import time. (`.env.local` must exist — it is the local dev
config; copy it from `.env.local.example`.)

### Faking the session

There is no Lambda authorizer locally, so `@beesolve/auth-service` injects a dev
session automatically. Set `DEV_USER_EMAIL` in `.env.local` to a **real** user's
email in the DMARC table — the app looks it up to resolve that user's role
(admin/user) and permitted domains, so you see the same UI they would. This is
guarded by `import.meta.env.DEV` and is never included in the deployed bundle.

If `DEV_USER_EMAIL` is unset, the auth service falls back to its built-in
`dev-user` session, which won't resolve against the table (nav hides
admin-only links and data lookups for that user return nothing).

### Required env vars

See [`.env.local.example`](./.env.local.example) for the full list. Beyond the two
table vars, the auth/email/consumer SDK clients parse their own env at import
time (auth handler ARN, email queue/table/bucket, tasks queue), so all must be
present or the first request will throw.

## Features

- Domain overview with aggregate pass/fail stats
- Per-domain report timeline with pagination
- User management (invite, remove)
- Email-code sign-in (no passwords)

## Source IP enrichment (ipinfo.io)

Source IPs can be enriched with ASN / organization name and country via the free
ipinfo.io Lite API. This is optional — without a key the ASN / country columns
render as `—`. See [docs/ipinfo-setup.md](./docs/ipinfo-setup.md) for how to obtain
a key and configure it locally and in a deployment.

## License

[MIT](../../LICENSE)
