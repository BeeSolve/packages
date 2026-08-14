# Phase 4: DMARC Dashboard — Implementation Plan

## Overview

Build a SvelteKit dashboard for viewing DMARC reports. Uses Graffiti CSS library (`@drop-in/graffiti`) for styling, `@beesolve/auth-service` for email OTP authentication, and deploys via kit-on-lambda behind CloudFront.

## Architecture

```
User → CloudFront → Lambda (SvelteKit SSR) → DynamoDB (same table as dmarc-consumer)
                                            → Auth Service (OTP sign-in)
```

**Package model:** `@beesolve/dmarc-dashboard` is a publishable package that exports:

- `@beesolve/dmarc-dashboard/cdk` — CDK construct for deployment
- The SvelteKit app (pre-built, bundled into the CDK construct's Lambda asset)

**Integration point:** `samples/dmarcReports` is the reference deployment that instantiates all three DMARC constructs together (`DmarcReports` + `DmarcConsumer` + `DmarcDashboard`), proving the packages compose correctly.

Single DynamoDB table shared with `@beesolve/dmarc-consumer`. Three entity types:

| Entity | PK                | SK                                 | Purpose                    |
| ------ | ----------------- | ---------------------------------- | -------------------------- |
| Report | `domain#<domain>` | `<timestamp>#<orgName>#<reportId>` | Individual DMARC reports   |
| Domain | `domain#<domain>` | `domain`                           | Aggregated domain stats    |
| User   | `user#<email>`    | `user`                             | User record with whitelist |

## Changes by Package

### `@beesolve/dmarc-consumer`

1. **Rename** `model.ts` → `report.ts` (class name: `Reports`)
2. **New file** `domain.ts` — class `Domains`
3. **Add reverse GSI** to CDK construct (pk: `sk`, sk: `pk`)
4. **Update consumer Lambda** to call `Domains.upsert()` after persisting each report
5. **Update exports** in `package.json`

### `@beesolve/dmarc-dashboard` (new package)

1. SvelteKit app with Graffiti CSS
2. `Users` model (same DynamoDB table)
3. CLI script for user creation
4. CDK construct for deployment
5. Auth integration with `@beesolve/auth-service`

---

## Task Breakdown

### Task 1: Rename `model.ts` → `report.ts` in `@beesolve/dmarc-consumer` ✅

- Rename file: `model.ts` → `report.ts`
- Rename class: `DmarcConsumerModel` → `Reports`
- Update all imports (consumer Lambda, tests, package exports)
- Update `package.json` exports: `"./model"` → `"./report"`
- Update `tsconfig.json` includes
- Verify: `bun run type-check`, `bun test`, `bun run lint`

### Task 2: Add reverse GSI to CDK construct ✅

- Add GSI to `DmarcConsumer` CDK construct:
  - GSI name: `"reverse"` (or `"gsi-reverse"`)
  - Partition key: `sk` (String)
  - Sort key: `pk` (String)
- Expose GSI name as property on the construct
- Update CDK test assertions
- Verify: `bun test`

### Task 3: Implement `Domains` model in `@beesolve/dmarc-consumer` ✅

- Create `domain.ts` with class `Domains`
- Schema (Valibot):
  - `pk`: string (`"domain#<domain>"`)
  - `sk`: literal `"domain"`
  - `domain`: string
  - `totalMessages`: number
  - `totalPass`: number
  - `totalFail`: number
- Methods:
  - `upsert({ domain, totalMessages, totalPass, totalFail })` — `UpdateCommand` with `SET domain = :domain, sk = :sk` + `ADD totalMessages :msgs, totalPass :pass, totalFail :fail`. Uses `domain#<domain>` as pk, `"domain"` as sk.
  - `list()` — `QueryCommand` on reverse GSI where `sk = "domain"`. Returns all domain records.
- Add `"./domain"` export to `package.json`
- Add `domain.ts` to `tsconfig.json` includes
- Write tests in `tests/domain.test.ts`
- Verify: `bun run type-check`, `bun test`, `bun run lint`

### Task 4: Update consumer Lambda to upsert domains ✅

- Import `Domains` in consumer handler
- After `reports.persist({ reports })`, compute per-domain aggregates from the batch
- Call `domains.upsert(...)` for each domain in the batch
- Update consumer tests to verify domain upsert is called
- Update CDK construct: consumer Lambda needs read+write (already has write via `grantWriteData`)
- Verify: `bun test`

### Task 5: Scaffold `@beesolve/dmarc-dashboard` package ✅

- Create `packages/dmarc-dashboard/` with:
  - `package.json` (private, not published to npm)
  - `tsconfig.json`
  - `svelte.config.js`
  - `vite.config.ts`
- Dependencies:
  - `@drop-in/graffiti` (CSS library)
  - `@sveltejs/kit`, `svelte`
  - `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb`
  - `@beesolve/auth-service` (workspace, for session handle + SDK)
  - `@beesolve/dmarc-consumer` (workspace, for `Reports` and `Domains` models)
  - `valibot`
- Add workspace entry in root `package.json`
- Verify: `bun install`, basic `svelte-check` passes

### Task 6: Implement `Users` model in dashboard ✅

- Create `src/lib/server/users.ts` — class `Users`
- Schema:
  - `pk`: `"user#<email>"`
  - `sk`: `"user"`
  - `email`: string
  - `domains`: `string[]` (whitelisted domain names)
- Methods:
  - `getByEmail({ email })` — `GetCommand` by pk/sk, returns user or throws
  - `create({ email, domains })` — `PutCommand` with condition `attribute_not_exists(pk)`
- Write tests in `tests/users.test.ts`
- Verify: `bun test`

### Task 7: CLI script for user creation ✅

- Create `scripts/create-user.ts`
- Usage: `bun run create-user --email foo@bar.com --domains example.org,example.com`
- Steps:
  1. Parse args (email, comma-separated domains)
  2. Call `AuthClient.invoke({ type: "newEmailAccount", request: { emailAddress } })` to register in auth-service
  3. Call `Users.create({ email, domains })` to store whitelist in DynamoDB
- Required env vars: `BEESOLVE_AUTH_SDK_HANDLER_ARN`, `DMARC_TABLE_NAME`
- Add script to `package.json`: `"create-user": "bun scripts/create-user.ts"`

### Task 8: Auth integration (SvelteKit hooks) ✅ (feedback addressed)

- Create `src/hooks.server.ts`
- Use `createSessionHandle()` from `@beesolve/auth-service/sveltekit` (or `createInProcessSessionHandle()`)
- Sign-up disabled — only pre-registered users can sign in
- Create sign-in page at `/sign-in` (simple email + OTP form)
- Protected routes: redirect to `/sign-in` if no session
- Load user's domain whitelist into session/locals after auth

### Task 9: Dashboard pages ✅

- **Layout** (`src/routes/+layout.svelte`):
  - Import `@drop-in/graffiti`
  - Navigation header with sign-out button
  - Show current user email

- **Domain list** (`src/routes/+page.svelte`):
  - Server load: fetch domains from `Domains.list()`, filter by user's whitelist
  - Display: table/list with domain name, total messages, pass rate (totalPass/totalMessages)
  - Each domain links to `/domains/[domain]`

- **Domain reports** (`src/routes/domains/[domain]/+page.svelte`):
  - Server load: check domain is in user's whitelist (403 if not), fetch reports via `Reports.queryByDomain({ domain })`
  - Display: table of reports — date, org, total messages, pass/fail counts
  - Pagination via cursor (load more button)
  - Optional: date range filter (startTime/endTime)

- **403 page** (`src/routes/+error.svelte` or explicit):
  - Show "Access denied" when user tries to access unauthorized domain

### Task 10: CDK construct for dashboard deployment ✅

- Create `cdk.ts` in `packages/dmarc-dashboard/`
- CDK construct `DmarcDashboard`:
  - kit-on-lambda deployment (SvelteKit SSR Lambda + CloudFront)
  - Auth service integration (reference existing auth stack outputs)
  - Props: auth service ARN, dmarc-consumer table reference (or table name + GSI name)
  - IAM: Lambda reads DynamoDB (dmarc table), invokes auth SDK handler
- Reference `@beesolve/cdk-constructs` for `Nodejs24Function`
- Reference existing kit-on-lambda patterns from samples
- Export the construct via `@beesolve/dmarc-dashboard/cdk`
- **Pre-built assets:** The SvelteKit app is built at publish time (same pattern as `@beesolve/service-email` and `@beesolve/dmarc-reports`):
  - `build.ts` script: runs `vite build` (SvelteKit adapter) → produces Lambda handler + static assets in `dist/`
  - `prepublishOnly` script in `package.json` triggers the build
  - CDK construct references `dist/` for the Lambda code asset and static files
  - Consumers (`samples/dmarcReports`) get a ready-to-deploy package — no SvelteKit/Vite build at `cdk deploy` time
- `package.json` `files` field includes `dist/` so pre-built assets are published to npm

### Task 11: Integrate into `samples/dmarcReports` ✅

- Update `packages/samples/dmarcReports/stack.ts` to instantiate both:
  - `DmarcReports` (already present — SES → S3 → EventBridge)
  - `DmarcConsumer` (EventBridge → SQS → DynamoDB)
  - `DmarcDashboard` (SvelteKit + CloudFront)
- Wire them together: pass consumer's table to dashboard construct
- Add required env vars to `mise.toml.example` (auth ARN, etc.)
- Add `create-user` script invocation docs to samples README
- Verify: `bunx cdk synth SamplesDmarcReports` synthesizes without errors

### Task 12: End-to-end validation ✅

- `bun run build` — all packages build
- `bun run type-check` — clean
- `bun run lint` — clean
- `bun run fmt:check` — clean
- `bun test` — all tests pass
- `bun run recalculate-dependencies` — update `dependencies.json`

---

## Design Decisions

### Why Graffiti CSS (not Tailwind, etc.)

- CSS-only library — no build plugin, no class generation, no JS runtime
- Standards-first: uses native CSS features (layers, container queries, OKLCH)
- Small footprint, good defaults for a simple internal dashboard
- Works out of the box with SvelteKit (no framework adapter needed)

### Why Users model in dashboard (not in dmarc-consumer)

- Users are a dashboard concern — the consumer doesn't need to know about access control
- Keeps `dmarc-consumer` focused on ingestion/persistence only
- The user model shares the same DynamoDB table but lives in a different package

### Why same DynamoDB table for all entities

- Single-table design is already established (reports use `domain#x` pk pattern)
- No additional CDK resources or IAM grants to wire
- Reverse GSI enables querying by entity type (`sk = "domain"`, `sk = "user"`)
- Low volume — no hot partition concerns

### Why sign-up is disabled

- This is an internal tool — only explicitly invited users should access it
- Admin creates users via CLI, which both registers the auth account and sets domain whitelist
- Prevents unauthorized sign-up even if someone discovers the URL

---

## Open Questions (to resolve during implementation)

1. **Graffiti theme** — which preset to use? (`system`, `studio`, `signal`?) — can pick during UI implementation
2. **kit-on-lambda adapter** — need to confirm which SvelteKit adapter is used for Lambda deployment in existing samples
3. **Session handle mode** — `createSessionHandle()` (authorizer pattern) vs `createInProcessSessionHandle()` — depends on deployment topology
