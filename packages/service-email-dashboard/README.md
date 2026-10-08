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
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { EmailServiceDashboard } from "@beesolve/email-service-dashboard/cdk";
import { App, Stack } from "aws-cdk-lib";
import { EventBus } from "aws-cdk-lib/aws-events";

const frontendUri = process.env.FRONTEND_URI;
if (frontendUri == null) throw new Error("FRONTEND_URI environment variable is required");

const app = new App();
const stack = new Stack(app, "EmailDashboardStack", {
  env: { account: "123456789012", region: "eu-central-1" },
});

const authEventBus = new EventBus(stack, "AuthEventBus");

const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: false,
  authorizerCache: "disabled",
  // Give the dashboard's own auth its own bus so its sign-in OTP events don't
  // collide with the project's real auth on the default bus. Optional — omit to
  // share the default bus and rely on `appId` for source-based isolation instead.
  eventBusArn: authEventBus.eventBusArn,
});

const dashboard = new EmailServiceDashboard(stack, "Dashboard", {
  auth,
  emailSender: {
    name: "Email Dashboard",
    emailAddress: "noreply@example.com",
  },
  // isProd?: boolean       — enables PITR on the table
  // removalPolicy?: RemovalPolicy
});
```

The `EmailServiceDashboard` construct provisions:

- a DynamoDB `TableV2` (the delivery-status projection) with one reverse GSI
- the SvelteKit app on Lambda (via `kit-on-lambda`) behind CloudFront, with auth cookie enforcement and an `/auth/*` behavior
- an `@beesolve/email-service` `Emails` construct for OTP mail
- an auth-events consumer Lambda + EventBridge rule that sends the sign-in OTP emails, bound to `auth.eventBus` and filtered on `auth.eventSource` (so it follows whatever bus/`appId` the auth deployment uses)
- an event-ingest Lambda fronted by an SQS queue + DLQ, with an EventBridge rule on `source: ["beesolve.email.api", "aws.ses"]` **on the default bus**, projecting the delivery lifecycle into the table

> **Two buses, by design.** The dashboard's own sign-in auth can live on a
> dedicated bus (via `auth`'s `eventBusArn`), but the delivery-status events it
> _displays_ always arrive on the account `default` bus — SES configuration-set
> event destinations can only target the default bus. The two internal rules are
> bound accordingly: the auth rule to `auth.eventBus`, the email-events rule to
> `default`. The dashboard therefore has no `eventBusName` prop.

## Data layer (remote functions)

The dashboard reads and writes its data through SvelteKit remote functions, not
`+page.server.ts` `load`/`actions`. Definitions live in `src/lib/remote/*.remote.ts`,
organized by domain area (`overview`, `messages`, `recipients`, `users`, `setup`):

- `query(...)` for reads (overview, message list, message detail, recipients list,
  recipient detail). URL filters such as `year`/`month`/`cursor` are passed as
  Valibot-validated arguments.
- `form(...)` for user-submitted mutations (invite user, edit user, complete setup).
- `command(...)` for programmatic mutations invoked from event handlers. The
  on-demand message body (`loadMessageBody`) is a `command` so S3 is read only when
  the user triggers it, never during the detail `query`.

Each function reads request context via `getRequestEvent().locals` (`locals.user`,
`locals.session`, `locals.services`), which `hooks.server.ts` populates. Admin guards
live inside the remote functions. After a mutation, the relevant `query(...).refresh()`
is called for a single-flight UI update.

Error mapping is centralized in [`src/lib/server/httpErrors.ts`](./src/lib/server/httpErrors.ts):
`toRemoteError(error, { redirectOnUnauthorized })` turns domain errors into SvelteKit
`error()`/`redirect()`, and `requireUser(user)` guards a present session. Call
`toRemoteError(...)` directly inside a `catch` - never `throw` its result.

Remote functions are enabled by `experimental.remoteFunctions` and
`compilerOptions.experimental.async` in `vite.config.ts`. The only retained server
loads are `+layout.server.ts` (supplies `user` and the setup redirect), the
`setup/+page.server.ts` redirect guard, and the sign-in universal/layout loads.
Environment variables are declared in `src/env.ts` via `defineEnvVars` and imported,
typed and validated, from `$app/env/private`.

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

`bun run dev` serves on http://localhost:5173. The `dev` script runs `bun --env-file=.env.local vite dev`, so `.env.local` is loaded into `process.env` before the server starts. The table vars are then declared in `src/env.ts` (`defineEnvVars`) and read, typed and validated, from `$app/env/private` in `hooks.server.ts`; the workspace SDK clients still read their own vars from `process.env` at import time.

### Faking the session

There is no Lambda authorizer locally, so `@beesolve/auth-service` injects a dev session automatically. Set `DEV_USER_EMAIL` in `.env.local` to a **real** user's email so the app resolves that user's role and shows the UI they would see. This is guarded by `import.meta.env.DEV` and is never included in the deployed bundle.

### Required env vars

- `DASHBOARD_TABLE_NAME` — the projection table name (injected by the construct in deployment)
- `DASHBOARD_REVERSE_INDEX` — the reverse GSI name (injected by the construct in deployment)
- `DASHBOARD_REQUESTS_BUCKET` — the bucket holding on-demand message request bodies
- `DEV_USER_EMAIL` — local development only; the user whose session is faked

The table/bucket vars are declared in `src/env.ts` and validated by `defineEnvVars`
when first imported from `$app/env/private`, so they must be present for the app to
start — the `build` script sets `build-placeholder` values for exactly this reason
(see below).

## Deployment notes (kit-on-lambda + CloudFront)

- **Externalize `@beesolve/lambda-fetch-api` for SSR.** The vite config must set `ssr.external: ["@beesolve/lambda-fetch-api"]`. Without it, Vite creates a duplicate `AsyncLocalStorage` instance and the SDK's handler context is lost at runtime.
- **Use default form actions.** SvelteKit named form actions use `?/name` in the URL; the `/` in the query string is rejected/misrouted by CloudFront behind kit-on-lambda. Use the default (unnamed) form action.
- **Placeholder build env.** The env vars declared in `src/env.ts` are validated by `defineEnvVars` when `$app/env/private` is first imported during SSR analysis, so the `build` script supplies `DASHBOARD_TABLE_NAME` / `DASHBOARD_REVERSE_INDEX` / `DASHBOARD_REQUESTS_BUCKET` placeholders to let the build complete.

## License

[MIT](../../LICENSE)
