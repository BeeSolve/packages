# Dashboards: Migrate to SvelteKit Remote Functions

## Status: Not Started

## Problem Statement

Both dashboards (`@beesolve/dmarc-dashboard` and `@beesolve/email-service-dashboard`) are on SvelteKit 3 / Svelte 5.57 and currently communicate with the server through `+page.server.ts` `load` functions and form `actions`. SvelteKit 3's remote functions (`query`/`form`/`command` in `.remote.ts` files) are now stable enough to adopt and give end-to-end type safety, single-flight mutations, and co-located client/server data access.

The sibling project `../expense-ease` already runs this exact stack (SvelteKit 3, Svelte 5.57, Vite 8, `kit-on-lambda@1.0.0`, `@drop-in/graffiti`, `@beesolve/auth-service` with `createSessionHandle`, `@beesolve/lambda-fetch-api`) with remote functions in production. This plan ports that proven pattern into both dashboards. expense-ease is the authoritative reference for every pattern below; read it before and during execution.

Goal: convert all `load` functions to `query`, all form `actions` to `form`/`command`, adopt expense-ease's `$app/env/private` env-resolution approach, and keep the existing auth boundary, services wiring, and CloudFront `/auth/*` flows unchanged.

## Architecture / Approach

### Reference files in `../expense-ease` (read these first)

- `vite.config.ts` — experimental flags: `experimental.remoteFunctions: true` and `compilerOptions.experimental.async: true`.
- `src/env.ts` — `defineEnvVars` from `@sveltejs/kit/env` with Valibot schemas (the env-resolution pattern to adopt).
- `src/hooks.server.ts` — services wired onto `event.locals.services`, env read from `$app/env/private`, `sequence(createSessionHandle({ fallbackSession }), authGuard)`.
- `src/lib/server/httpErrors.ts` — `toRemoteError(error, { redirectOnUnauthorized })` and `requireUser(user)` helpers.
- `src/lib/remote/*.remote.ts` — `query` / `form` / `command` definitions using `getRequestEvent().locals`, Valibot schema args, and `.refresh()` for single-flight invalidation. `groups.remote.ts` shows all three kinds.
- `src/routes/(app)/app/settings/+page.svelte` — client consumption: `fn.enhance(...)`, `{...enhanced}` form spread, `fn.fields.name.as("text")`, `fn.result`.

### Env resolution (adopt expense-ease pattern)

Replace the manual `v.parse(envSchema, process.env)` in each dashboard's `hooks.server.ts` with a `src/env.ts` module using SvelteKit's native typed env:

```ts
// src/env.ts
import { defineEnvVars } from "@sveltejs/kit/env";
import * as v from "valibot";

export const variables = defineEnvVars({
  DMARC_TABLE_NAME: { schema: v.string() },
  DMARC_REVERSE_INDEX: { schema: v.string() },
  IPINFO_API_KEY: { schema: v.optional(v.string()) },
});
```

`src/env.ts` is the SvelteKit convention path; vars become importable (typed + validated) from `$app/env/private`:

```ts
// hooks.server.ts
import { DMARC_TABLE_NAME, DMARC_REVERSE_INDEX, IPINFO_API_KEY } from "$app/env/private";
```

Per-dashboard var sets (from current `hooks.server.ts`):

- **dmarc-dashboard:** `DMARC_TABLE_NAME` (string), `DMARC_REVERSE_INDEX` (string), `IPINFO_API_KEY` (optional string).
- **email-service-dashboard:** `DASHBOARD_TABLE_NAME` (string), `DASHBOARD_REVERSE_INDEX` (string), `DASHBOARD_REQUESTS_BUCKET` (string).

The `build` scripts in each `package.json` set these as placeholder env vars at build time (e.g. `DMARC_TABLE_NAME=build-placeholder vite build`); `defineEnvVars` validates them the same way, so the build scripts stay as-is.

### Remote function conventions (match expense-ease)

- Location: central `src/lib/remote/<area>.remote.ts` (NOT colocated with routes).
- Access request context inside each function via `const { locals } = getRequestEvent();` then `locals.services` / `locals.user`.
- Validate args with existing Valibot schemas; keep schemas in `src/lib/server/schemas.ts` (new) or alongside the remote module.
- `query` for reads (optionally schema-validated args replacing `url.searchParams` reads).
- `form` for user-submitted forms (replaces `use:enhance` POST actions).
- `command` for programmatic mutations invoked from event handlers.
- After a mutation, call the relevant `query(...).refresh()` for single-flight updates (see `groups.remote.ts`).
- Error handling: in `catch`, call `toRemoteError(error)` directly (do NOT `throw toRemoteError(...)` — trips `only-throw-error`). Use `{ redirectOnUnauthorized: true }` for queries/forms that should bounce to `/sign-in`.

### Auth boundary (unchanged)

`hooks.server.ts` keeps `sequence(createSessionHandle({ fallbackSession }), authGuard)`. `event.locals.session`, `event.locals.user`, and `event.locals.services` continue to be populated by the handle hooks and are visible to remote functions via `getRequestEvent()`. Per-page admin/domain guards (currently inline `error(403)` / `requireDomainAccess`) move into the remote functions.

### SSR externals (keep the existing caveat)

Both dashboards consume `@beesolve/auth-service` via `workspace:^`, so Vite bundles the workspace source and would create a duplicate `AsyncLocalStorage` instance. **Keep** `ssr.external: ["@beesolve/lambda-fetch-api"]` in each `vite.config.ts`. expense-ease omits it only because it consumes `@beesolve/auth-service` as a published npm package; that difference does not apply here. Remote functions rely on `getRequestEvent()` (also AsyncLocalStorage-based), so this externalization is still required.

### Out of scope (leave untouched)

- `/auth/*` flows and the sign-in / verify `fetch()` calls (`/auth/signInRequest`, `/auth/signInComplete`, `/auth/signOut`) — these hit a separate CloudFront behavior pointing at the auth-service origin, not SvelteKit routes.
- The two universal `+page.ts` loads (`sign-in/verify/+page.ts`) — they only read URL params.
- `sign-in/+layout.server.ts` loads.

### Key Design Decisions

- Adopt `defineEnvVars` / `$app/env/private` to match expense-ease and remove hand-rolled `process.env` parsing.
- Centralize remote functions in `src/lib/remote/` by domain area, matching expense-ease's organization rather than colocating per route.
- Keep `createSessionHandle` (Lambda-authorizer pattern); no switch to `createInProcessSessionHandle`.
- Keep `ssr.external` for `@beesolve/lambda-fetch-api` because these packages use `workspace:^`.
- Migrate per-dashboard and per-area so each task is independently verifiable; prove the deployed runtime path early (Task 2) before converting the bulk.
- `recipients/keys/+server.ts` (JSON GET endpoint) may be converted to a `query` but is low value; convert only if a client actually consumes it — otherwise leave as a `+server.ts`.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task. After each task, the user reviews changes and signals "continue" to proceed.

**Reference project:** `../expense-ease` (sibling repo). Subagents should read the reference files listed under "Architecture / Approach" before implementing. Do not modify expense-ease.

**Check gates** (run after every task, in the dashboard package being changed):

1. `bun run type-check` (`svelte-kit sync && svelte-check`)
2. `bun run build` (uses placeholder env vars from the `build` script)
3. `bun test`

**Rules for subagents:**

- Each task must be self-contained.
- No commits — leave changes uncommitted for review.
- Follow the project's code style (see `.kiro/steering/`): no narrating comments, Oxfmt/Oxlint, `import type`, Valibot `v.picklist` for literal unions, `== null` checks, descriptive array-method variable names.
- UI: graffiti-first. When touching `.svelte` files, do not re-implement graffiti components or hand-roll class names that collide with graffiti globals (see `sveltekit-lambda` steering).
- Keep `ssr.external: ["@beesolve/lambda-fetch-api"]` in `vite.config.ts`.
- Do not touch `/auth/*` flows, the sign-in/verify universal loads, or CDK stacks.
- In remote-function `catch` blocks, call `toRemoteError(error)` directly — never `throw` its result.
- Use the default (unnamed) form action semantics via `form()`; never introduce named `?/action` routes (breaks behind CloudFront).

**Operational notes:**

- Experimental flags live in `vite.config.ts` under the `sveltekit({ ... })` plugin options (there is no separate `svelte.config.js` in these packages).
- `src/env.ts` is auto-discovered by SvelteKit; no config entry needed. Run `svelte-kit sync` (via `type-check`) to regenerate `$app/env/private` types.
- Build tool for the monorepo is bunup, but dashboards build via `vite build` (see each `package.json` `build` script).

## Tasks

### Task 1: Enable remote functions + adopt `$app/env/private` (both dashboards)

Enable the experimental flags and migrate env resolution to the expense-ease pattern. No `.remote.ts` files yet — this task only flips the config and swaps env wiring so the subsequent per-area tasks have the foundation. Behavior must stay identical (loads/actions still work).

- [ ] In both `packages/dmarc-dashboard/vite.config.ts` and `packages/service-email-dashboard/vite.config.ts`, add to the `sveltekit({ ... })` options: `experimental: { remoteFunctions: true }` and `compilerOptions: { experimental: { async: true } }`. Match expense-ease's `vite.config.ts`.
- [ ] Keep the existing `ssr.external: ["@beesolve/lambda-fetch-api"]`, `paths`, and `css`/`build` lightningcss settings unchanged.
- [ ] Create `packages/dmarc-dashboard/src/env.ts` with `defineEnvVars` for `DMARC_TABLE_NAME` (string), `DMARC_REVERSE_INDEX` (string), `IPINFO_API_KEY` (optional string).
- [ ] Create `packages/service-email-dashboard/src/env.ts` with `defineEnvVars` for `DASHBOARD_TABLE_NAME` (string), `DASHBOARD_REVERSE_INDEX` (string), `DASHBOARD_REQUESTS_BUCKET` (string).
- [ ] In each `hooks.server.ts`, delete the local `envSchema` + `v.parse(..., process.env)` block and import the vars from `$app/env/private` instead. Leave the `DEV_USER_EMAIL` dev-fallback logic (which reads `process.env` directly) as-is.
- [ ] Run `svelte-kit sync` so `$app/env/private` type definitions are generated.

**Files:** `packages/dmarc-dashboard/vite.config.ts`, `packages/dmarc-dashboard/src/env.ts`, `packages/dmarc-dashboard/src/hooks.server.ts`, `packages/service-email-dashboard/vite.config.ts`, `packages/service-email-dashboard/src/env.ts`, `packages/service-email-dashboard/src/hooks.server.ts`

**Acceptance criteria:** Both dashboards pass `bun run type-check` and `bun run build` with no behavior change. `$app/env/private` imports resolve. All existing `load`/`actions` still function.

---

### Task 2: Add `httpErrors` helper + prove the runtime path (dmarc, one read-only page)

Create the shared error helper and convert exactly ONE read-only page end-to-end to validate remote functions work through `kit-on-lambda` + CloudFront before converting the bulk. This is the single genuinely risky step — it must be deploy-verified by the user before continuing.

- [ ] Create `packages/dmarc-dashboard/src/lib/server/httpErrors.ts` modeled on `../expense-ease/src/lib/server/httpErrors.ts`: a `toRemoteError(error, { redirectOnUnauthorized? })` that maps domain errors to SvelteKit `error()`/`redirect()`, and a `requireUser(user)` guard returning the non-null user or `error(401)`. Adapt the mapped error types to the dmarc dashboard's domain errors (e.g. `ReportNotFoundError`, `UserNotFoundError`, user `type !== "admin"` → 403).
- [ ] Create `packages/dmarc-dashboard/src/lib/remote/domains.remote.ts` with `export const listDomains = query(async () => { ... })` reproducing `routes/+page.server.ts`'s load: read `locals.user`/`locals.services.domains.list()`, filter by `user.domains` for non-admins, return the same shape.
- [ ] Convert `routes/+page.svelte` to call `listDomains()` (async mode / `{#await}` as needed) instead of reading `data`. Remove the now-unused `routes/+page.server.ts` load (or reduce it) only if nothing else depends on it; `+layout.server.ts` still supplies `user`.
- [ ] Keep graffiti markup intact.

**Files:** `packages/dmarc-dashboard/src/lib/server/httpErrors.ts`, `packages/dmarc-dashboard/src/lib/remote/domains.remote.ts`, `packages/dmarc-dashboard/src/routes/+page.svelte`, `packages/dmarc-dashboard/src/routes/+page.server.ts`

**Acceptance criteria:** `type-check`, `build`, `test` pass. **User deploys and confirms the home page loads via the remote `query` behind CloudFront before Task 3.** This gate de-risks the rest of the plan.

---

### Task 3: Convert remaining dmarc read-only loads to `query`

Convert the dmarc dashboard's read-only pages (loads with no actions) to `query` functions. URL-search-param reads become schema-validated query args.

- [ ] `stats/+page.server.ts` → `listStats` query in `src/lib/remote/stats.remote.ts` (admin guard via `requireUser` + type check → 403). Returns the same `stats`/`totals`/`dateRange` shape.
- [ ] `domains/[domain]/reports/[reportId]/+page.server.ts` → `getReport` query (schema arg `{ domain, reportId }`); preserve `decodeReportKey`, IP enrichment, `ReportNotFoundError` → 404, invalid key → 400.
- [ ] For `domains/[domain]/+page.server.ts`, convert only the LOAD half to a `getDomainOverview` query here (schema args `{ domain, cursor?, date?, month? }` replacing `url.searchParams`); keep its form action for Task 4. Preserve `requireDomainAccess`, aggregation, IP enrichment, and the returned shape.
- [ ] Update the corresponding `.svelte` files to call the queries; keep graffiti markup.

**Files:** `packages/dmarc-dashboard/src/lib/remote/stats.remote.ts`, `packages/dmarc-dashboard/src/lib/remote/reports.remote.ts`, `packages/dmarc-dashboard/src/lib/remote/domains.remote.ts` (extend), and the matching `routes/**/+page.svelte` + `+page.server.ts` files.

**Acceptance criteria:** `type-check`, `build`, `test` pass. Stats, report detail, and domain overview pages render via queries. Query-string filters (cursor/date/month) still work.

---

### Task 4: Convert dmarc form actions to `form` / `command`

Convert the dmarc dashboard's five form actions and their `use:enhance` components.

- [ ] `setup/+page.server.ts` action → `completeSetup` form (validate email, create auth account tolerating "already exists", create admin user, `markComplete`, redirect to `/sign-in`). Keep the load guard (redirect to `/sign-in` if already complete) as a `query` or in the remaining `+page.server.ts` load.
- [ ] `users/+page.server.ts` action (delete user) → `deleteUser` form/command (admin guard, block self-delete, `deleteAllSessions` + `users.delete`, refresh `listUsers`). Convert its load to a `listUsers` query.
- [ ] `users/invite/+page.server.ts` action → `inviteUser` form (admin guard, validate email + domains, create auth account, create user handling `UserAlreadyExistsError` → 400, send invite email, redirect). Convert its load (available domains) to a query.
- [ ] `users/[email]/edit/+page.server.ts` action → `updateUser` form (admin guard, block self-role-change, validate domains + `v.picklist(userTypes)`, `updateDomains` + `updateType`, `UserNotFoundError` → 404). Convert its load (target user + available domains) to a query.
- [ ] `domains/[domain]/+page.server.ts` action (refresh-dns / refresh-ips) → `refreshDomain` command/form (domain guard, `v.picklist(["refresh-dns","refresh-ips"])`, enqueue, 409 when already running). Refresh `getDomainOverview`.
- [ ] Rewrite each `.svelte` form: replace `<form method="POST" use:enhance={...}>` with the remote `form` spread (`{...inviteUser}` / `fn.enhance(...)`), using `fn.fields.*.as(...)` and `fn.result` for errors/loading. Model on `../expense-ease/src/routes/(app)/app/settings/+page.svelte`. Keep graffiti markup.

**Files:** new `src/lib/remote/{setup,users,domains}.remote.ts` (extend domains), updated `routes/{setup,users,users/invite,users/[email]/edit,domains/[domain]}/+page.svelte` and their `+page.server.ts`.

**Acceptance criteria:** `type-check`, `build`, `test` pass. All five mutations work with validation errors surfaced in the UI; redirects and single-flight refreshes behave as before.

---

### Task 5: Convert email-service-dashboard read-only loads to `query`

Create the email dashboard's `httpErrors.ts` and convert its read-only pages.

- [ ] Create `packages/service-email-dashboard/src/lib/server/httpErrors.ts` (same pattern as Task 2, adapted to email dashboard domain errors; user has `{ email, type }` only).
- [ ] `+page.server.ts` (dashboard overview: global stats + recent + `averageDeliveryMs`) → `getOverview` query. Preserve the `averageDeliveryMs` computation.
- [ ] `messages/+page.server.ts` → `listMessages` query (schema args `{ year?, month?, cursor? }` with the same defaulting logic).
- [ ] `recipients/+page.server.ts` → `listRecipients` query (`{ cursor? }`).
- [ ] `recipients/[email]/+page.server.ts` → `getRecipient` query (`{ email, year?, month?, cursor? }`), preserving the parallel stats + history fetch.
- [ ] `messages/[messageId]/+page.server.ts` LOAD → `getMessage` query (`{ messageId }`, 404 when missing); keep its action for Task 6.
- [ ] Update the matching `.svelte` files; keep graffiti markup.
- [ ] `recipients/keys/+server.ts`: leave as a `+server.ts` GET unless a client consumes it (check `recipients/**/+page.svelte` and `.ts` for a `fetch("/recipients/keys")`); convert to a `query` only if consumed.

**Files:** `packages/service-email-dashboard/src/lib/server/httpErrors.ts`, `packages/service-email-dashboard/src/lib/remote/{overview,messages,recipients}.remote.ts`, matching `routes/**/+page.svelte` + `+page.server.ts`.

**Acceptance criteria:** `type-check`, `build`, `test` pass. Overview, messages list, message detail (load only), recipients list, and recipient detail render via queries with working month/cursor filters.

---

### Task 6: Convert email-service-dashboard form actions to `form` / `command`

Convert the email dashboard's five form actions and their components.

- [ ] `messages/[messageId]/+page.server.ts` action (fetch request body from S3 on demand) → `loadMessageBody` command/form (`{ messageId }`, returns `{ request }` or `{ bodyUnavailable: true }`). Keep the on-demand semantics (do not fetch in the query).
- [ ] `setup/+page.server.ts` action → `completeSetup` form (same shape as dmarc setup, adapted to email dashboard services).
- [ ] `users/+page.server.ts` action (delete) → `deleteUser` form/command; convert load to `listUsers` query.
- [ ] `users/invite/+page.server.ts` action → `inviteUser` form; convert load to a query.
- [ ] `users/[email]/edit/+page.server.ts` action → `updateUser` form; convert load to a query.
- [ ] Rewrite each `.svelte` form to the remote `form` spread pattern (`fn.enhance`, `fn.fields`, `fn.result`), modeled on expense-ease. Keep graffiti markup.

**Files:** new/extended `src/lib/remote/{messages,setup,users}.remote.ts`, updated `routes/{messages/[messageId],setup,users,users/invite,users/[email]/edit}/+page.svelte` and their `+page.server.ts`.

**Acceptance criteria:** `type-check`, `build`, `test` pass. All five mutations work; message-body-on-demand still only reads S3 when triggered.

---

### Task 7: Cleanup, app.d.ts, docs, and changesets

Final sweep across both dashboards.

- [ ] Remove any now-empty `+page.server.ts` files whose entire load+actions moved to remote functions (keep `+layout.server.ts` which supplies `user`, and the sign-in universal loads).
- [ ] Confirm `app.d.ts` `App.Locals` still matches what remote functions read via `getRequestEvent()` (no change expected; verify).
- [ ] Update each package's `DOCS.md` / `docs/how-to` and `README.md` to describe the remote-functions data layer, and add an ADR per `.kiro/steering/adrs` convention: `packages/dmarc-dashboard/docs/adr-00N-remote-functions.md` and the email dashboard equivalent, documenting the choice (stable SK3 remote functions, expense-ease precedent, `ssr.external` requirement, env via `$app/env/private`).
- [ ] Create changesets. Read each `package.json` `name` first: `packages/dmarc-dashboard` → `@beesolve/dmarc-dashboard`; `packages/service-email-dashboard` → `@beesolve/email-service-dashboard`. Minor bump for both (internal data-layer refactor, no public API change).
- [ ] Full verification: `bun run type-check`, `bun run build`, `bun test` for both dashboards.

**Files:** both `app.d.ts`, both `DOCS.md`/`README.md`, two new ADR files, two changeset files, removal of dead `+page.server.ts` files.

**Acceptance criteria:** Both dashboards fully on remote functions with no leftover `load`/`actions` except the intentionally retained universal/layout loads. Check gates pass. ADRs + changesets present. User deploy-verifies both dashboards end-to-end.

---

## Future Work (out of scope)

- Converting `recipients/keys/+server.ts` to a remote `query` if/when a client consumes it.
- Migrating the sign-in / verify `fetch("/auth/...")` calls — these target the auth-service CloudFront origin, not SvelteKit, and are a separate concern.
- Switching from `createSessionHandle` to `createInProcessSessionHandle` (single-Lambda-per-request) — orthogonal to remote functions.
- Enabling OpenTelemetry tracing for remote functions (experimental SK observability).
