# @beesolve/email-service-dashboard

SvelteKit dashboard for viewing `@beesolve/email-service` delivery status — deployed on AWS Lambda behind CloudFront with email-code authentication. It runs its own event-ingest Lambda that projects the email delivery lifecycle (from EventBridge) into its own DynamoDB table, so the UI has durable, queryable message + status + aggregate-stats data.

## Architecture

```
  email-service ──► SES ──► EventBridge  (beesolve.email.api / aws.ses)
                                 │
                                 ▼
                    event-ingest Lambda (SQS-buffered)
                                 │  parse → Messages.upsert (transactional)
                                 ▼
┌────────────┐     ┌──────────────┐     ┌──────────┐
│ CloudFront │ ──► │ Lambda (SSR) │ ──► │ DynamoDB │  (dashboard's own projection)
└────────────┘     └──────────────┘     └──────────┘
       │                                       ▲
       └── /auth/* ──► AuthGateway             │  OTP emails via
                       (authorizer)            └─ @beesolve/email-service
```

## What the dashboard shows

- **Overview** — global aggregate counters (received / sent / delivered / bounced / complained / rejected / failed) and derived totals.
- **Messages** — sent messages listed by month, newest-first, paginated; status badge per message.
- **Message detail** — the per-recipient delivery timeline, variant status detail (bounce diagnostics, complaint feedback, reject reason, delivery latency), and an on-demand **"view message body"** action (fetched via `email.getMessage(requestId)`, never stored — available only while the source `EmailLog` record still exists).
- **Recipients** — all recipients with per-recipient counters, and per-recipient message history.
- Email-code sign-in (no passwords) and admin user management.

Opens and clicks are intentionally out of scope.

## Prerequisites

```bash
npm install \
  @beesolve/email-service-dashboard \
  @beesolve/email-service \
  @beesolve/auth-service \
  aws-cdk \
  aws-cdk-lib \
  constructs
```

- [`@beesolve/email-service`](../service-email) — sends the transactional email and emits the lifecycle events this dashboard projects
- [`@beesolve/auth-service`](../service-auth) — email-code authentication with session management

## CDK Setup

Only the `./cdk` construct is exported. Construct an `AuthGateway` first, then hand it to the dashboard:

```typescript
import { App, Stack } from "aws-cdk-lib";
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { EmailServiceDashboard } from "@beesolve/email-service-dashboard/cdk";

const frontendUri = process.env.FRONTEND_URI;
if (frontendUri == null) throw new Error("FRONTEND_URI environment variable is required");

const app = new App();
const stack = new Stack(app, "EmailDashboardStack", {
  env: { account: "123456789012", region: "eu-central-1" },
});

const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: false,
  authorizerCache: "disabled",
});

const dashboard = new EmailServiceDashboard(stack, "Dashboard", {
  auth,
  emailSender: {
    name: "Email Dashboard",
    emailAddress: "noreply@example.com",
  },
  // eventBusName?: string  — the bus email-service emits to. @default "default"
  // isProd?: boolean       — enables PITR on the table
  // removalPolicy?: RemovalPolicy
});
```

The `EmailServiceDashboard` construct provisions:

- a DynamoDB `TableV2` (the delivery-status projection) with one reverse GSI
- the SvelteKit app on Lambda (via `kit-on-lambda`) behind CloudFront, with auth cookie enforcement and an `/auth/*` behavior
- an `@beesolve/email-service` `Emails` construct for OTP mail
- an auth-events consumer Lambda + EventBridge rule (`source: ["beesolve.auth.api"]`) that sends the sign-in OTP emails
- an event-ingest Lambda fronted by an SQS queue + DLQ, with an EventBridge rule on `source: ["beesolve.email.api", "aws.ses"]`, projecting the delivery lifecycle into the table

## First Deployment

The SvelteKit build requires a `FRONTEND_URI` environment variable (the CloudFront URL), which does not exist until after the first deploy:

1. Set `FRONTEND_URI` to a placeholder URL (e.g. `https://placeholder.cloudfront.net`)
2. Deploy — note the CloudFront URL from CDK output
3. Update `FRONTEND_URI` with the real URL and redeploy

## Local Development

```bash
bun install
cp .env.local.example .env.local   # then fill in real values
aws sso login                      # (or export AWS_PROFILE) so SDK clients can reach AWS
bun run dev
```

`bun run dev` serves on http://localhost:5173. The `dev` script runs `bun --env-file=.env.local vite dev`, so `.env.local` is loaded into `process.env` before the server starts, where both `hooks.server.ts` and the workspace SDK clients read it at import time.

### Faking the session

There is no Lambda authorizer locally, so `@beesolve/auth-service` injects a dev session automatically. Set `DEV_USER_EMAIL` in `.env.local` to a **real** user's email so the app resolves that user's role and shows the UI they would see. This is guarded by `import.meta.env.DEV` and is never included in the deployed bundle.

### Required env vars

- `DASHBOARD_TABLE_NAME` — the projection table name (injected by the construct in deployment)
- `DASHBOARD_REVERSE_INDEX` — the reverse GSI name (injected by the construct in deployment)
- `DEV_USER_EMAIL` — local development only; the user whose session is faked

Both table vars are parsed eagerly at module load, so they must be present for the app to start — the `build` script sets `build-placeholder` values for exactly this reason (see below).

## Deployment notes (kit-on-lambda + CloudFront)

- **Externalize `@beesolve/lambda-fetch-api` for SSR.** The vite config must set `ssr.external: ["@beesolve/lambda-fetch-api"]`. Without it, Vite creates a duplicate `AsyncLocalStorage` instance and the SDK's handler context is lost at runtime.
- **Use default form actions.** SvelteKit named form actions use `?/name` in the URL; the `/` in the query string is rejected/misrouted by CloudFront behind kit-on-lambda. Use the default (unnamed) form action.
- **Placeholder build env.** `hooks.server.ts` parses required env vars at import time, and `vite build` imports it during SSR analysis, so the `build` script supplies `DASHBOARD_TABLE_NAME` / `DASHBOARD_REVERSE_INDEX` placeholders to let the build complete.

## License

[MIT](../../LICENSE)
