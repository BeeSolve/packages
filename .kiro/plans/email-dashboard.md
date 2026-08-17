# Email Dashboard

## Status: Not Started

## Problem Statement

The `@beesolve/email-service` package provides email sending infrastructure with SES, SQS, and DynamoDB. It stores sent message records (with TTL) and emits EventBridge events for delivery, bounce, complaint, and reject outcomes. However, there's no user-facing interface to view email logs, search by recipient/time range, or inspect delivery status.

We need a dashboard — similar in architecture, theme, and UX to the existing `@beesolve/dmarc-dashboard` — that lets users:

- View email send history with delivery status
- Search by recipient email address and time range
- Inspect individual email details (subject, recipients, status timeline)
- See aggregate stats (sends, deliveries, bounces, complaints over time)

The dashboard will be an optional SvelteKit package, prebuilt and published to npm, deployed via a CDK construct into the user's AWS account — identical deployment model to the DMARC dashboard.

## Architecture / Approach

### Data Model

The email-service already stores message records in DynamoDB with:

- **Message record**: `pk=requestId`, `sk=messageId` — the original request
- **Recipient index**: `pk=recipientEmail`, `sk=ISO_timestamp` — pointer back to message

However, delivery events (bounces, complaints, deliveries) are only emitted to EventBridge and NOT persisted. The dashboard needs its own **event consumer** Lambda that subscribes to these events and writes them to DynamoDB.

**New DynamoDB items (in the email-dashboard's own table):**

```
Users & Setup (same pattern as dmarc-dashboard):
  pk: "user#<email>"      sk: "user"              — user record
  pk: "system#config"     sk: "setup"             — setup completion

Email log entries (written by event consumer):
  pk: "msg#<messageId>"   sk: "send"              — base record (from EmailSentSuccess)
  pk: "msg#<messageId>"   sk: "event#<timestamp>" — delivery/bounce/complaint events
  pk: "rcpt#<email>"      sk: "<ISO_timestamp>#<messageId>" — recipient timeline index
```

The `msg#` partition allows fetching all events for a single email. The `rcpt#` partition allows querying all emails sent to a given address ordered by time — supporting the "search by recipient + time range" use case with KeyConditionExpression on sk BETWEEN.

A GSI (`sk`→`pk` reverse index, same as dmarc-dashboard) enables listing all users.

### Public API Surface

The package exports only a CDK construct:

```ts
import { EmailDashboard } from "@beesolve/email-dashboard/cdk";
```

Props:

```ts
interface EmailDashboardProps {
  readonly auth: AuthGateway;
  readonly emails: Emails; // from @beesolve/email-service/cdk
  readonly emailSender: { name: string; emailAddress: string };
}
```

### Cross-Package Dependencies

- `@beesolve/auth-service` (workspace:^) — session handling, OTP sign-in, CDK AuthGateway
- `@beesolve/email-service` (workspace:^) — events types, SDK for getMessage, CDK Emails construct for grantAccess + EventBridge source
- `@beesolve/cdk-constructs` (workspace:^) — Nodejs24Function
- `@beesolve/lambda-fetch-api` (workspace:^) — Lambda handler context
- `kit-on-lambda` — SvelteKit adapter + CDK construct
- `@drop-in/graffiti` — shared design system (same as dmarc-dashboard)

### CDK Construct

The `EmailDashboard` construct will:

1. Create a DynamoDB table (pk/sk composite key, reverse index GSI, TTL)
2. Deploy the SvelteKit app via `kit-on-lambda` behind CloudFront
3. Wire auth via `props.auth` (same authorizer pattern as dmarc-dashboard)
4. Create an event consumer Lambda subscribed to:
   - `beesolve.email.api` source (EmailSentSuccess, EmailSentFailure)
   - `aws.ses` source (Delivery, Bounce, Complaint, Reject)
5. Create an auth consumer Lambda for OTP emails (same as dmarc-dashboard)
6. Grant the SvelteKit handler read access to both:
   - The dashboard's own table (event log + users)
   - The email-service's table (original message content via getMessage pattern)

### SvelteKit Routes

```
/              — Overview: recent sends, aggregate stats (last 24h/7d/30d)
/messages      — Paginated message list with status badges
/messages/[id] — Single message detail: recipients, subject, full event timeline
/search        — Search by recipient email + optional time range
/stats         — Admin-only: sends/deliveries/bounces/complaints over time (chart data)
/users         — Admin-only: user management (same as dmarc-dashboard)
/users/invite  — Invite user
/setup         — One-time admin setup (identical to dmarc-dashboard)
/sign-in       — OTP sign-in (identical to dmarc-dashboard)
/sign-in/verify — OTP verification
```

### Key Design Decisions

- **Own DynamoDB table** — the dashboard gets its own table rather than writing to the email-service's table. This keeps the email-service's table TTL-controlled and avoids coupling.
- **Event consumer persists history** — since the email-service only stores send requests (with TTL), the dashboard's consumer subscribes to all events and persists them with configurable retention.
- **Same auth/setup pattern** — exact copy of dmarc-dashboard's auth guard, setup flow, and user management. No need to abstract this yet.
- **Recipient search via sort key range** — `sk BETWEEN <start> AND <end>` on the `rcpt#<email>` partition gives time-bounded search without a GSI.
- **Status derivation** — message status is derived from the latest event: sent → delivered / bounced / complained / rejected. Timeline shows all events.
- **No domains concept** — unlike dmarc-dashboard which scopes by domain, this dashboard shows all emails. Admin/user distinction controls who can access.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (tests across all packages — note: SvelteKit packages may only need `svelte-check`)

**Rules for subagents:**

- Each task must be self-contained
- No commits — leave changes uncommitted for review
- Follow the project's code style (see `.kiro/steering/`)
- If check gates fail on unrelated existing issues, note them but don't fix
- Use `workspace:^` for intra-monorepo dependencies
- Use `catalog:` for shared external dependencies
- Run `bun install` after adding dependencies
- Use the dmarc-dashboard as the reference implementation — copy patterns exactly unless stated otherwise

**Operational notes:**

- The SvelteKit build requires env vars even at build time (use placeholders like dmarc-dashboard does)
- SSR externals: must externalize `@beesolve/lambda-fetch-api` in vite.config.ts
- Use Svelte 5 runes (`$props`, `$state`, `$derived`) — no legacy reactive syntax
- Use `@sveltejs/kit` v2 with Vite 8
- Formatter for this package: Prettier (Biome lacks Svelte support)

## Tasks

### Task 1: Scaffold the email-dashboard package

- [ ] Create `packages/email-dashboard/` with the SvelteKit project structure mirroring dmarc-dashboard
- [ ] Create `package.json` with name `@beesolve/email-dashboard`, same dependency pattern as dmarc-dashboard (catalog: for AWS SDKs, workspace:^ for internal packages)
- [ ] Create `svelte.config.js` with `kit-on-lambda` adapter (output to `dist/build`)
- [ ] Create `vite.config.ts` with SSR externals for `@beesolve/lambda-fetch-api`
- [ ] Create `tsconfig.json` extending SvelteKit defaults
- [ ] Create `src/app.html` (same as dmarc-dashboard)
- [ ] Create `src/app.d.ts` with `App.Locals` type declarations (session, user, services)
- [ ] Create `build.ts` script for bundling the event consumer Lambda (same pattern as dmarc-dashboard's `build.ts`)
- [ ] Add scripts: `dev`, `build`, `type-check`, `test`, `prepublishOnly`
- [ ] Run `bun install`

**Files:** `packages/email-dashboard/package.json`, `packages/email-dashboard/svelte.config.js`, `packages/email-dashboard/vite.config.ts`, `packages/email-dashboard/tsconfig.json`, `packages/email-dashboard/src/app.html`, `packages/email-dashboard/src/app.d.ts`, `packages/email-dashboard/build.ts`

**Acceptance criteria:** `bun install` succeeds, `svelte-kit sync` succeeds, package structure matches dmarc-dashboard's layout

---

### Task 2: Users, Setup, and shared server modules

- [ ] Create `src/lib/server/users.ts` — copy from dmarc-dashboard (Users class with getByEmail, create, listAll, delete, hasAnyUsers, updateType)
- [ ] Create `src/lib/server/setup.ts` — copy from dmarc-dashboard (Setup class with isComplete, markComplete)
- [ ] Create `src/lib/server/messages.ts` — Messages class for querying the dashboard's DynamoDB table:
  - `listRecent({ limit, cursor })` — query reverse index for `sk = "send"` sorted by timestamp descending
  - `getById({ messageId })` — query `pk = "msg#<messageId>"` to get base record + all events
  - `searchByRecipient({ email, from?, to?, limit, cursor })` — query `pk = "rcpt#<email>"` with optional sk BETWEEN for time range
  - `putEvent(event)` — write an event record (used by the consumer Lambda)
  - `putSendRecord(record)` — write the base send record

**Files:** `packages/email-dashboard/src/lib/server/users.ts`, `packages/email-dashboard/src/lib/server/setup.ts`, `packages/email-dashboard/src/lib/server/messages.ts`

**Acceptance criteria:** TypeScript compiles, classes follow dmarc-dashboard's DynamoDB access patterns with Valibot validation

---

### Task 3: Event consumer Lambda

- [ ] Create `src/eventConsumer.ts` — Lambda handler subscribed to EventBridge (via SQS or direct):
  - Handles `EmailSentSuccess` → writes send record (`pk: "msg#<messageId>", sk: "send"`) + recipient index entries (`pk: "rcpt#<email>", sk: "<timestamp>#<messageId>"`)
  - Handles `EmailSentFailure` → writes failure record
  - Handles SES events (Delivery, Bounce, Complaint, Reject) → writes event record (`pk: "msg#<messageId>", sk: "event#<timestamp>"`)
  - Uses `parseEmailEvent` from `@beesolve/email-service/events` for parsing
  - All writes include TTL based on configurable retention days (env var)
- [ ] Use the same `@beesolve/helpers` utilities (splitArrayToChunks, etc.)

**Files:** `packages/email-dashboard/src/eventConsumer.ts`

**Acceptance criteria:** TypeScript compiles, handler processes all event types and writes correct DynamoDB items

---

### Task 4: Hooks, auth guard, and service instantiation

- [ ] Create `src/hooks.server.ts` following dmarc-dashboard pattern exactly:
  - Validate env vars with Valibot (`EMAIL_DASHBOARD_TABLE_NAME`, `EMAIL_DASHBOARD_REVERSE_INDEX`, `EMAIL_SERVICE_TABLE_NAME`)
  - Create DynamoDB document client with `removeUndefinedValues: true`
  - Instantiate Users, Setup, Messages, AuthClient, Email
  - `createSessionHandle()` + `authGuard` in `sequence()`
  - Auth guard attaches services to `event.locals.services`, redirects unauthenticated users, fetches user record for authenticated requests
  - Public paths: `/sign-in`, `/sign-in/verify`, `/setup`

**Files:** `packages/email-dashboard/src/hooks.server.ts`

**Acceptance criteria:** TypeScript compiles, follows identical pattern to dmarc-dashboard's hooks.server.ts

---

### Task 5: Layout, theme, and sign-in routes

- [ ] Create `src/routes/+layout.svelte` — same theme/CSS as dmarc-dashboard, nav brand "Email Dashboard", nav links: Messages, Search, Stats (admin), Users (admin)
- [ ] Create `src/routes/+layout.server.ts` — pass user data to layout
- [ ] Create `src/routes/sign-in/+page.svelte` and `src/routes/sign-in/+page.server.ts` — copy from dmarc-dashboard
- [ ] Create `src/routes/sign-in/verify/+page.svelte` and `src/routes/sign-in/verify/+page.server.ts` — copy from dmarc-dashboard
- [ ] Create `src/routes/setup/+page.svelte` and `src/routes/setup/+page.server.ts` — copy from dmarc-dashboard

**Files:** `packages/email-dashboard/src/routes/+layout.svelte`, `packages/email-dashboard/src/routes/+layout.server.ts`, `packages/email-dashboard/src/routes/sign-in/+page.svelte`, `packages/email-dashboard/src/routes/sign-in/+page.server.ts`, `packages/email-dashboard/src/routes/sign-in/verify/+page.svelte`, `packages/email-dashboard/src/routes/sign-in/verify/+page.server.ts`, `packages/email-dashboard/src/routes/setup/+page.svelte`, `packages/email-dashboard/src/routes/setup/+page.server.ts`

**Acceptance criteria:** `svelte-check` passes, layout renders correctly, sign-in flow is identical to dmarc-dashboard

---

### Task 6: Home page and messages list route

- [ ] Create `src/routes/+page.server.ts` — load recent messages (last 50) with status summary (counts of sent/delivered/bounced/complained in last 24h)
- [ ] Create `src/routes/+page.svelte` — overview page showing:
  - Summary cards: total sent (24h), delivered, bounced, complained
  - Recent messages table: timestamp, recipient(s), subject, status badge
  - Link to `/messages` for full list
- [ ] Create `src/routes/messages/+page.server.ts` — paginated message list with cursor pagination
- [ ] Create `src/routes/messages/+page.svelte` — full paginated table with status badges, clickable rows linking to `/messages/[id]`
- [ ] Create `src/lib/components/statusBadge.svelte` — color-coded badge (delivered=green, bounced=red, complained=yellow, sent=gray, failed=red)

**Files:** `packages/email-dashboard/src/routes/+page.server.ts`, `packages/email-dashboard/src/routes/+page.svelte`, `packages/email-dashboard/src/routes/messages/+page.server.ts`, `packages/email-dashboard/src/routes/messages/+page.svelte`, `packages/email-dashboard/src/lib/components/statusBadge.svelte`

**Acceptance criteria:** `svelte-check` passes, pages display message data with proper status indicators

---

### Task 7: Message detail route

- [ ] Create `src/routes/messages/[id]/+page.server.ts` — load message by ID (all events for that messageId)
- [ ] Create `src/routes/messages/[id]/+page.svelte` — detail page showing:
  - Header: subject, sent timestamp, status badge
  - Recipients list
  - Event timeline (chronological list of all events: sent, delivered, bounced, complained, rejected) with timestamps and details
  - Sender info
  - Optionally fetch original message content from email-service table via getMessage

**Files:** `packages/email-dashboard/src/routes/messages/[id]/+page.server.ts`, `packages/email-dashboard/src/routes/messages/[id]/+page.svelte`

**Acceptance criteria:** `svelte-check` passes, detail page shows complete message info with event timeline

---

### Task 8: Search route

- [ ] Create `src/routes/search/+page.server.ts` — accepts query params `email`, `from` (ISO date), `to` (ISO date); queries the `rcpt#<email>` partition with time range
- [ ] Create `src/routes/search/+page.svelte` — search form with:
  - Email input (required)
  - Date range inputs (optional: from/to)
  - Results table (same format as messages list: timestamp, subject, status)
  - Pagination support

**Files:** `packages/email-dashboard/src/routes/search/+page.server.ts`, `packages/email-dashboard/src/routes/search/+page.svelte`

**Acceptance criteria:** `svelte-check` passes, search by recipient returns time-ordered results, date range filters work

---

### Task 9: Stats route (admin-only)

- [ ] Create `src/routes/stats/+page.server.ts` — aggregate stats for last 30 days: daily counts of sends, deliveries, bounces, complaints
- [ ] Create `src/routes/stats/+page.svelte` — admin-only page showing:
  - Summary totals for the period
  - Daily breakdown table (date, sent, delivered, bounced, complained)
  - Delivery rate, bounce rate percentages

**Files:** `packages/email-dashboard/src/routes/stats/+page.server.ts`, `packages/email-dashboard/src/routes/stats/+page.svelte`

**Acceptance criteria:** `svelte-check` passes, admin-only access enforced, stats display correctly

---

### Task 10: Users routes (admin-only)

- [ ] Create `src/routes/users/+page.server.ts` and `+page.svelte` — list all users, delete action (same as dmarc-dashboard)
- [ ] Create `src/routes/users/invite/+page.server.ts` and `+page.svelte` — invite form (same as dmarc-dashboard)
- [ ] Admin-only access enforcement (403 for non-admins)

**Files:** `packages/email-dashboard/src/routes/users/+page.server.ts`, `packages/email-dashboard/src/routes/users/+page.svelte`, `packages/email-dashboard/src/routes/users/invite/+page.server.ts`, `packages/email-dashboard/src/routes/users/invite/+page.svelte`

**Acceptance criteria:** `svelte-check` passes, user management works identically to dmarc-dashboard

---

### Task 11: CDK construct

- [ ] Create `packages/email-dashboard/cdk.ts` — `EmailDashboard` CDK construct:
  - Creates DynamoDB TableV2 (pk/sk, reverse index GSI on sk→pk, TTL attribute)
  - Creates SvelteKit site via `kit-on-lambda` (same pattern as dmarc-dashboard)
  - Wires auth (addAuthorizedEndpoint, grantSdkAccess, ensureCookieFunction, createAuthBehavior)
  - Creates event consumer Lambda subscribed to EventBridge rules for `beesolve.email.api` + `aws.ses` sources
  - Creates auth consumer Lambda for OTP emails
  - Creates Emails construct for sending OTP emails
  - Grants site handler read/write on dashboard table + read on email-service table
  - Exports `distribution` property
- [ ] Update `package.json` exports to expose `./cdk`

**Files:** `packages/email-dashboard/cdk.ts`

**Acceptance criteria:** TypeScript compiles, CDK construct follows same pattern as dmarc-dashboard's cdk.ts

---

### Task 12: Auth consumer Lambda and final wiring

- [ ] Create `src/authConsumer.ts` — handles `EmailCodeAuth` and `UnsuccessfulAuth` events, sends OTP emails (copy from dmarc-dashboard)
- [ ] Create `packages/email-dashboard/docs/adr-001-motivation.md` — motivation ADR
- [ ] Verify full type-check passes: `svelte-kit sync && svelte-check`
- [ ] Verify `bun run check` passes
- [ ] Verify the build script works: `bun build.ts`

**Files:** `packages/email-dashboard/src/authConsumer.ts`, `packages/email-dashboard/docs/adr-001-motivation.md`

**Acceptance criteria:** All check gates pass, package is ready for first deployment

---

## Future Work (out of scope)

- Email content preview (rendering HTML body in the dashboard)
- Webhook/notification on bounce/complaint thresholds
- Export/download of email logs (CSV)
- Per-domain or per-sender filtering
- Shared component library extracted from dmarc-dashboard + email-dashboard
- Rate limiting visibility (SES quotas)
- Integration with SNS for real-time alerts
