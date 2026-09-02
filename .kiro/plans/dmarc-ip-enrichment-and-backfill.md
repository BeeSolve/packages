# DMARC Source IP Enrichment + Per-Domain Backfill

## Status: Complete

## Problem Statement

The DMARC dashboard's Source IP Analysis table shows raw source IPs and pass/fail
counts, which is unreadable to a human trying to tell "my mail provider" apart from
"a botnet spoofing my domain." We are adding two capabilities:

1. **Source IP enrichment** — resolve each source IP to an ASN / organization name
   (e.g. "Google LLC") and country via the free [ipinfo.io Lite API](https://ipinfo.io/developers/lite-api),
   cached per-IP in the existing DynamoDB table, plus dashboard UI that surfaces a
   plain-language verdict, a spoofing-blocked count, `headerFrom`, raw SPF/DKIM
   results, policy-override reasons, and an authorized-senders alignment panel.

2. **Per-domain backfill** — a UI-triggered, SQS-driven job (owned by `dmarc-consumer`,
   exposed to the dashboard through a type-safe SDK) that paginates existing reports
   for a domain, collects unique source IPs, and populates the enrichment cache for
   historical data. Backfill state is tracked in DynamoDB (a single latest-per-domain
   config record + per-run history), and the dashboard enables/disables the per-domain
   button based on that state.

Enrichment is **optional**: when no `IPINFO_API_KEY` is configured, enrichment and
backfill lookups are no-ops and the dashboard renders without ASN/country populated.

## Current State of the Working Tree (IMPORTANT — read before starting)

A previous round of work already left **uncommitted** changes implementing an earlier
version of enrichment. The executing agent must **adjust** these rather than assume a
clean slate. Existing uncommitted changes:

- `packages/dmarc-consumer/ipInfo.ts` (new) — contains `lookupIpInfo`, `IpInfoCache`
  with a **staleness/`maxAgeDays` refresh** and a `get`/`getMany`/`put`/`enrich`/`enrichMany`
  surface. **This plan removes the staleness logic** (see Task 1).
- `packages/dmarc-consumer/tests/ipInfo.test.ts` (new) — tests including stale/refresh
  cases that must be updated.
- `packages/dmarc-consumer/docs/adr-002-ip-enrichment-cache.md` (new) — ADR currently
  describes the staleness approach; must be updated to presence-only caching.
- `packages/dmarc-consumer/src/consumer.ts` — enrichment wired into the handler.
- `packages/dmarc-consumer/cdk.ts` — `ipInfoApiKey` prop + `IPINFO_API_KEY` env +
  `grantReadWriteData`.
- `packages/dmarc-consumer/package.json`, `bunup.config.ts`, `tsconfig.json` — `ipInfo.ts`
  entry/export added.
- `packages/dmarc-dashboard/src/lib/server/aggregate.ts` — verdict/spoofing/alignment
  aggregation.
- `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts` and
  `+page.svelte` — enrichment merge + UI columns/cards/panel.
- `packages/dmarc-dashboard/src/app.d.ts`, `src/hooks.server.ts` — `ipInfoCache` service.
- `.changeset/ip-enrichment.md` — changeset for both packages.

The enrichment feature (Tasks 1–2) is therefore mostly a **refinement** of existing
uncommitted code; the backfill feature (Tasks 3–7) is net-new.

## Architecture / Approach

### Enrichment caching model

- ipinfo.io **Lite API**: `GET https://api.ipinfo.io/lite/{ip}` with
  `Authorization: Bearer {apiKey}`. Response fields used: `asn`, `as_name`, `as_domain`,
  `country_code`, `country` (Lite is free with unlimited lookups for these).
- Cache item per IP in the existing table: `pk: ipinfo#<ip>`, `sk: ipinfo`, holding
  `ip`, `asn?`, `asName?`, `asDomain?`, `countryCode?`, `country?`, `fetchedAt` (ISO).
- **Cache-first by presence, no TTL, no staleness refresh.** If an IP is already in the
  table, use it and never call ipinfo again for that IP. `fetchedAt` is stored as
  informational metadata only — never read for expiry decisions. This avoids
  overfetching. (Rationale: ASN/country drift rarely; read-write grant is required
  anyway for backfill, so the cost of the earlier "override-always" tradeoff is moot.)
- Reads use `BatchGetCommand` chunked to **100 keys max** (DynamoDB BatchGet limit) via
  `splitArrayToChunks` from `@beesolve/helpers`.

### Backfill architecture (chosen: SDK + sqs-handler, owned by dmarc-consumer)

Rejected alternatives and the reasoning are in "Key Design Decisions". Chosen design:

- `dmarc-consumer` **owns** the backfill queue, worker Lambda, and status model —
  because it already owns the table, the report query layer (`Reports.queryByDomain`),
  and the enrichment cache (`IpInfoCache`). Backfill is "re-run enrichment over existing
  reports," which is a consumer responsibility.
- `dmarc-consumer` exposes a **type-safe SDK** (`@beesolve/dmarc-consumer/sdk`, class
  `BackfillSdk`) that the dashboard uses for **all** backfill operations. The dashboard
  writes **no** backfill logic of its own beyond instantiating the SDK and calling it.
- The SDK's enqueue path uses `@beesolve/sqs-handler`'s typed `tasks` client (not a
  hand-rolled `SendMessageCommand`), keeping type-safety end to end.
- `runId` is generated with `uuid7` from `@beesolve/helpers` (time-ordered, unique —
  avoids same-second collisions in history keys).
- Backfill worker timeout: **5 minutes**.
- **NEVER SCAN.** The worker uses paginated `Reports.queryByDomain({ domain, cursor })`
  in a loop, following the cursor until exhausted, collecting the unique source IP set,
  then calls `IpInfoCache.enrichMany({ ips })` (which is cheap on re-runs thanks to
  presence-only caching).

### Types and Schemas

Enrichment (already present in `ipInfo.ts`, keep these shapes):

```ts
interface IpInfo {
  ip: string;
  asn?: string;
  asName?: string;
  asDomain?: string;
  countryCode?: string;
  country?: string;
}

const ipInfoCacheSchema = v.object({
  pk: v.string(), // ipinfo#<ip>
  sk: v.literal("ipinfo"),
  ip: v.string(),
  asn: v.optional(v.string()),
  asName: v.optional(v.string()),
  asDomain: v.optional(v.string()),
  countryCode: v.optional(v.string()),
  country: v.optional(v.string()),
  fetchedAt: v.string(),
});
```

Backfill status (new, in `packages/dmarc-consumer/backfill.ts`):

```ts
const backfillStatuses = ["pending", "started", "finished", "failed"] as const;
type BackfillStatus = (typeof backfillStatuses)[number]; // use v.picklist(backfillStatuses)

// Single latest-per-domain config record: pk: system#config, sk: ipBackfill
const backfillConfigSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.literal("ipBackfill"),
  domains: v.record(
    v.string(),
    v.object({
      status: v.picklist(backfillStatuses),
      runId: v.string(),
      startedAt: v.string(),
      finishedAt: v.optional(v.string()),
      ipsEnriched: v.optional(v.number()),
      reportsScanned: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
  ),
});

// Per-run history item: pk: backfill#<domain>, sk: run#<runId>
const backfillRunSchema = v.object({
  pk: v.string(), // backfill#<domain>
  sk: v.string(), // run#<runId>
  domain: v.string(),
  runId: v.string(),
  status: v.picklist(backfillStatuses),
  startedAt: v.string(),
  finishedAt: v.optional(v.string()),
  ipsEnriched: v.optional(v.number()),
  reportsScanned: v.optional(v.number()),
  error: v.optional(v.string()),
});
```

Note on Valibot: use `v.picklist(backfillStatuses)` with an `as const` array for the
string-literal union (workspace rule — never `v.union([v.literal(...), ...])`).

### Public API Surface

`@beesolve/dmarc-consumer/ip-info` (existing export, keep):

```ts
class IpInfoCache {
  constructor(props: { dynamo; tableName: string; apiKey?: string });
  get(props: { ip: string }): Promise<IpInfoCacheItem | null>;
  getMany(props: { ips: string[] }): Promise<Record<string, IpInfoCacheItem>>; // BatchGet, chunked 100
  put(props: { info: IpInfo }): Promise<IpInfoCacheItem>;
  enrich(props: { ip: string }): Promise<IpInfoCacheItem | null>; // presence-first; no staleness
  enrichMany(props: { ips: string[] }): Promise<Record<string, IpInfoCacheItem>>; // getMany → fetch only missing
}
```

`@beesolve/dmarc-consumer/sdk` (new export, class `BackfillSdk`):

```ts
class BackfillSdk {
  constructor(props: { dynamo; tableName: string });

  // Dashboard-facing:
  // Gate-checks the domain, writes `started` (conditional), creates history item,
  // enqueues tasks.backfillDomain({ domain, runId }). runId = uuid7().
  startBackfill(props: {
    domain: string;
  }): Promise<{ enqueued: true; runId: string } | { enqueued: false; reason: "already-running" }>;

  // Reads the single system#config/ipBackfill record and derives per-domain gate.
  // Not-found record → all canRun. Record present but domain absent → canRun.
  // status started|pending → canRun false. finished|failed → canRun true.
  getBackfillStatuses(props: { domains: string[] }): Promise<
    Array<{
      domain: string;
      canRun: boolean;
      lastRun?: {
        status: BackfillStatus;
        startedAt: string;
        finishedAt?: string;
        ipsEnriched?: number;
      };
    }>
  >;

  // Worker-facing (called by the backfill task handler):
  completeBackfill(props: {
    domain: string;
    runId: string;
    ipsEnriched: number;
    reportsScanned: number;
  }): Promise<void>;
  failBackfill(props: { domain: string; runId: string; error: string }): Promise<void>;
}
```

Backfill tasks file (new, `packages/dmarc-consumer/backfill/tasks.ts`) using
`createSqsHandlers` from `@beesolve/sqs-handler`:

```ts
export const [handler, tasks] = createSqsHandlers({
  fifo: false,
  sqsClient: new SQSClient(),
  queueUrls: { main: process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL! },
  functions: {
    backfillDomain: async ({ domain, runId }: { domain: string; runId: string }) => {
      // paginated queryByDomain loop → collect unique source IPs → enrichMany
      // → backfillSdk.completeBackfill(...) on success / failBackfill(...) on error
    },
  },
});
```

### Cross-Package Dependencies

- `dmarc-consumer` gains: `@beesolve/sqs-handler` (`workspace:^`), `@aws-sdk/client-sqs`
  (`catalog:`). `@beesolve/helpers` already present (for `splitArrayToChunks`, `uuid7`).
- `dmarc-dashboard` already depends on `@beesolve/dmarc-consumer` (`workspace:^`); it
  imports the new `/sdk` export. No new deps expected.

### CDK Constructs

`packages/dmarc-consumer/cdk.ts` (`DmarcConsumer` construct):

- Keep `ipInfoApiKey?: string` prop; keep `IPINFO_API_KEY` env on the ingestion consumer;
  keep `grantReadWriteData` on the ingestion consumer (needed for cache read + write).
- Add a `SqsHandler` (from `@beesolve/sqs-handler/cdk`) for the backfill worker:
  - `handlerProps.entry` → the compiled `backfill/tasks.ts`; `timeout: Duration.minutes(5)`.
  - Grant the backfill handler read-write on the table (`this.table.grantReadWriteData`)
    and set `IPINFO_API_KEY` env (from `ipInfoApiKey` prop) so it can enrich.
- Add a method `grantBackfill(lambda: LambdaFunction): void` that calls the backfill
  `SqsHandler.grantAccess(lambda)` — injects `BEESOLVE_TASKS_MAIN_QUEUE_URL` + SendMessage
  into the passed Lambda (used by the SvelteKit handler). Mirrors existing
  `grantRead`/`grantReadWrite` methods.

`packages/dmarc-dashboard/cdk.ts` (`DmarcDashboard` construct):

- Add `ipInfoApiKey?: string` to `DmarcDashboardProps` if the dashboard needs to pass it
  onward (the dashboard itself only READS the cache, so it does not need the key at
  runtime — the key lives on the consumer + backfill worker. Do NOT add key env to the
  dashboard handler). The dashboard's existing `props.consumer.grantReadWrite(site.handler)`
  already covers cache reads and the SDK's `started`/status writes.
- Add `props.consumer.grantBackfill(site.handler)` so the SvelteKit Lambda can enqueue.
- Watch the workspace `sveltekit-lambda` SSR-externals caveat: importing the consumer
  `/sdk` pulls in `@aws-sdk/client-sqs` + `sqs-handler`. Verify the vite build; if a
  duplicate-module or AsyncLocalStorage issue appears, add the offending module to
  `ssr.external` in `vite.config.ts`. (The SQS client is not expected to trigger the
  `AsyncLocalStorage` issue that affects `@beesolve/lambda-fetch-api`, but verify.)

### Key Design Decisions

- **Cache-first by presence, no staleness refresh.** Read grant is required for backfill
  anyway, so the earlier "override-always to avoid read grant" tradeoff is dropped.
  Presence-only caching avoids overfetching ipinfo. `fetchedAt` kept as metadata.
- **Backfill owned by dmarc-consumer, exposed via a type-safe SDK.** Keeps table access,
  querying, enrichment, and status model with the data they belong to. Dashboard becomes
  a pure consumer of the SDK (no backfill code of its own beyond instantiation + calls +
  a button). Chosen over: (a) worker living in the dashboard via sqs-handler (wrong
  ownership — dashboard would own queue infra + duplicate consumer logic), and (b)
  dashboard → EventBridge → consumer rule → SQS (adds an indirection the SDK removes
  while still being type-safe).
- **SDK enqueue uses sqs-handler's typed client**, not raw SendMessage — preserves the
  type-safety chain `startBackfill` → `tasks.backfillDomain({ domain, runId })` → worker.
- **Status writes split:** the SDK's `startBackfill` (running in the dashboard Lambda,
  which has read-write) writes `started` synchronously for an instant UI gate and
  double-click protection (conditional update); the worker writes terminal
  `finished`/`failed` + counts. Both reference the same `runId`.
- **Single latest-per-domain config record + full per-run history.** `system#config` /
  `ipBackfill` holds the latest run per domain (as a `domains` map); each run also
  appends a `backfill#<domain>` / `run#<runId>` history item retained indefinitely.
- **`runId` = uuid7** for uniqueness + time-ordering (avoids same-second history collisions).
- **Worker timeout 5 min**; ingestion consumer stays 30s (separate resource profiles).
- **Dedicated backfill worker** (not multiplexed into the ingestion handler) so the fast
  ingestion path keeps its short timeout.
- **Gate semantics** computed server-side in the SDK; frontend receives only
  `{ domain, canRun }` (+ optional last-run summary).

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run fmt` / `bun run fmt:check` (oxfmt)
2. `bun run lint` (oxlint)
3. `bun run type-check` (per changed package: `cd packages/<name> && bun run type-check`)
4. `bun test` (per changed package)

**Rules for subagents:**

- Each task must be self-contained.
- **No commits** — leave changes uncommitted for review.
- Follow the project's code style (see `.kiro/steering/` — TypeScript, git, adrs,
  sveltekit-lambda rules). Notable: `== null`/`!= null` for null checks; named object
  params for 3+ args; `import type`; `v.picklist` for string-literal unions; full
  descriptive names in array callbacks; barrel exports allowed in this repo only.
- DynamoDB clients must pass `marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false }`.
- Composite-key `attribute_not_exists` conditions must check BOTH `pk` AND `sk`.
- Use `workspace:^` for intra-monorepo deps, `catalog:` for shared external deps.
- After adding deps: `bun install`, then `bun run recalculate-dependencies` if it exists.
- The consumer package needs `bunup` to build the new entries before the dashboard can
  resolve them: `bunx bunup --filter @beesolve/dmarc-consumer` (or `bun run build`) so
  `dist/ipInfo.js`, `dist/sdk.js`, etc. exist for the dashboard's type-check/build.
- Package names differ from directory names — read `package.json` `name` before writing
  changesets. `packages/dmarc-consumer` → `@beesolve/dmarc-consumer`,
  `packages/dmarc-dashboard` → `@beesolve/dmarc-dashboard`.
- ADRs live in `packages/<name>/docs/`. New ADRs must be numbered; note that
  `dmarc-consumer/docs` already has TWO `adr-001-*` files (legacy collision) — new ADRs
  use `adr-002+`.
- If check gates fail on unrelated pre-existing issues, note them but do not fix.

## Tasks

### Task 1: Refine enrichment to presence-only caching (adjust existing uncommitted code)

- [x] Edit `packages/dmarc-consumer/ipInfo.ts`: remove `maxAgeDays`, `isStale`, and all
      staleness logic. `enrich({ ip })` = `get` → return if present, else fetch + `put`
      (null if no apiKey). `enrichMany({ ips })` = dedupe → `getMany` (BatchGet chunked
      100 via `splitArrayToChunks`) → for each IP NOT already cached, call ipinfo + `put`
      → return merged `Record<string, IpInfoCacheItem>`. Keep `fetchedAt` stored in `put`.
      Keep `lookupIpInfo`, the Valibot response schema, `get`, `getMany`, `put`.
- [x] Update `packages/dmarc-consumer/tests/ipInfo.test.ts`: remove stale/refresh and
      fallback-on-stale cases. Keep/adjust: no-op without apiKey; returns cached without
      calling API when present; fetches + stores when missing; **new** case: `enrichMany`
      only calls the API for IPs not already in the cache (mock `getMany` to return one
      of two IPs, assert fetch called once for the missing one); `getMany` keys by IP.
      Use `spyOn(globalThis, "fetch")` (no `as unknown as typeof fetch` casts — lint rule).
- [x] Update `packages/dmarc-consumer/docs/adr-002-ip-enrichment-cache.md`: change the
      Decision to presence-only caching (no TTL, no staleness refresh, `fetchedAt` as
      metadata). Add a "Future Work" section documenting the OPTIONAL later addition of a
      staleness/refresh mechanism (batch-read → conditional `PutCommand` with
      `attribute_not_exists(pk) AND attribute_not_exists(sk) OR fetchedAt < :cutoff`,
      noting the composite-key rule), explicitly marked unnecessary at current scale.
- [x] Confirm `cdk.ts` keeps `grantReadWriteData` on the ingestion consumer (needed for
      cache reads). Confirm `ipInfoApiKey` prop + `IPINFO_API_KEY` env remain.

**Files:** `packages/dmarc-consumer/ipInfo.ts`, `packages/dmarc-consumer/tests/ipInfo.test.ts`, `packages/dmarc-consumer/docs/adr-002-ip-enrichment-cache.md`, `packages/dmarc-consumer/cdk.ts`

**Acceptance criteria:** `bun test` in `dmarc-consumer` passes; `enrichMany` provably
skips already-cached IPs (asserted in a test); no lint warnings; ADR reflects presence-only.

---

### Task 2: Verify + finalize dashboard enrichment UI (adjust existing uncommitted code)

- [x] Review `packages/dmarc-dashboard/src/lib/server/aggregate.ts`: confirm it produces
      per-IP `verdict` (`legitimate|forwarded|spoofing|suspicious`), `spoofingAttempts`
      total, `senderAlignment`, and surfaces `headerFroms`, `spfResults`, `dkimResults`,
      `policyReasons`. Keep as implemented; fix only if type-check/lint fails.
- [x] Confirm `+page.server.ts` merges enrichment via `ipInfoCache.getMany` (READ-only;
      no API calls at render) into the breakdown + alignment rows.
- [x] Confirm `+page.svelte` renders: "Spoofing Blocked" summary card, Origin (ASN ·
      country) column, Verdict column, `From:`/auth-detail/policy-reason under each IP,
      Authorized Senders panel, and the scope note. Ensure `svelte-check` is clean.
- [x] Build the consumer first (`bunx bunup --filter @beesolve/dmarc-consumer`) so the
      dashboard resolves `@beesolve/dmarc-consumer/ip-info`.

**Files:** `packages/dmarc-dashboard/src/lib/server/aggregate.ts`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`, `packages/dmarc-dashboard/src/app.d.ts`, `packages/dmarc-dashboard/src/hooks.server.ts`

**Acceptance criteria:** `bun run type-check` (svelte-check) 0 errors; `bun run build`
succeeds; lint clean.

---

### Task 3: Backfill status model in dmarc-consumer

- [ ] Create `packages/dmarc-consumer/backfill.ts` with the `backfillStatuses` `as const`
      array + `v.picklist` schemas for the config record (`pk: system#config`, `sk:
ipBackfill`, `domains` map) and the run history item (`pk: backfill#<domain>`, `sk:
run#<runId>`). Export types. Follow the class + `parseOne` pattern from
      `domain.ts` / `processingStats.ts`.
- [x] Do NOT include SQS enqueue here yet (that's the SDK, Task 5) — this task is the
      pure DynamoDB status model. Implement helpers the SDK will use:
      `readConfig(): Promise<config | null>`, `writeStarted({ domain, runId, startedAt })`
      as an `UpdateCommand` on the single config item with a `ConditionExpression` that
      the domain is not already `started`/`pending` (nested-attribute condition), plus
      `putRunHistory(...)`, `completeRun(...)`, `failRun(...)` updating BOTH the config
      domain entry and the `run#<runId>` history item by key.
- [x] Tests `packages/dmarc-consumer/tests/backfill.test.ts`: writeStarted sends
      conditional UpdateCommand; completeRun updates config + history; gate derivation
      helper returns correct `canRun` for not-found / domain-absent / started / finished.

**Files:** `packages/dmarc-consumer/backfill.ts`, `packages/dmarc-consumer/tests/backfill.test.ts`

**Acceptance criteria:** `bun test` passes; conditional-update assertions verified.

---

### Task 4: Backfill SQS tasks handler in dmarc-consumer

- [x] Add deps to `packages/dmarc-consumer/package.json`: `@beesolve/sqs-handler`
      (`workspace:^`), `@aws-sdk/client-sqs` (`catalog:`). Run `bun install`.
- [x] Create `packages/dmarc-consumer/backfill/tasks.ts` using `createSqsHandlers`
      (standard queue) with function `backfillDomain({ domain, runId })` that: loops
      `Reports.queryByDomain({ domain, cursor })` following the cursor until exhausted
      (NEVER SCAN), collects the unique set of `record.sourceIp` across all pages and
      counts reports scanned, calls `IpInfoCache.enrichMany({ ips })`, then calls the
      backfill model's `completeRun` (ipsEnriched = size of enriched set, reportsScanned)
      on success or `failRun` on error. Construct `Reports`, `IpInfoCache`, and the
      backfill model at module scope from env (`TABLE_NAME`, `IPINFO_API_KEY`) using a
      DynamoDBDocumentClient with the required marshallOptions.
      (Implemented as `src/tasks.ts` + `src/runBackfill.ts` per review feedback — flat
      `src/` layout matching `src/consumer.ts`; no `backfill/` folder.)
- [x] Export `handler` for the Lambda entry.
- [x] Add `backfill/tasks.ts` to the build so a deployable handler bundle exists (mirror
      how `src/consumer.ts` is built in `build.ts` / the consumer's build setup).
      (Built as `./src/tasks.ts` → `dist/tasks/`.)

**Files:** `packages/dmarc-consumer/backfill/tasks.ts`, `packages/dmarc-consumer/package.json`, `packages/dmarc-consumer/build.ts`

**Acceptance criteria:** type-check passes; a test (or a `localInvocation` unit test)
exercises `backfillDomain` with a mocked `Reports`/`IpInfoCache` verifying pagination
loop, unique-IP collection, and `completeRun` call with correct counts.

---

### Task 5: BackfillSdk (dmarc-consumer /sdk export)

- [x] Create `packages/dmarc-consumer/sdk.ts` exporting class `BackfillSdk` constructed
      with `{ dynamo, tableName }`. Implement `startBackfill`, `getBackfillStatuses`,
      `completeBackfill`, `failBackfill` per the Public API Surface above. `startBackfill`
      generates `runId` via `uuid7` (`@beesolve/helpers`), calls the Task 3 model's
      conditional `writeStarted` + `putRunHistory`, then enqueues via the Task 4 `tasks`
      client (`tasks.backfillDomain({ domain, runId })`). On conditional-check failure
      (already running) return `{ enqueued: false, reason: "already-running" }`.
      `getBackfillStatuses` reads the config record and derives `canRun` per domain.
- [x] Guard against circular import (`sdk.ts` → `backfill/tasks.ts` → …). If the tasks
      file importing the SDK creates a cycle, split shared types into `backfill.ts` and
      keep the `tasks` client import one-directional.
- [x] Add `./sdk` to `package.json` exports and add `sdk.ts` (+ `backfill.ts`) to the
      `dmarc-consumer` entry array in `bunup.config.ts` and to `tsconfig.json` `include`.
- [x] Tests `packages/dmarc-consumer/tests/sdk.test.ts`: `startBackfill` enqueues + writes
      started on a free domain; returns `already-running` when the conditional write
      fails; `getBackfillStatuses` returns correct gates.

**Files:** `packages/dmarc-consumer/sdk.ts`, `packages/dmarc-consumer/package.json`, `bunup.config.ts`, `packages/dmarc-consumer/tsconfig.json`, `packages/dmarc-consumer/tests/sdk.test.ts`

**Acceptance criteria:** `bun test` passes; `bunx bunup --filter @beesolve/dmarc-consumer`
produces `dist/sdk.js` + `dist/sdk.d.ts`; no circular-import runtime error.

---

### Task 6: CDK — backfill worker + grantBackfill (dmarc-consumer + dashboard)

- [x] In `packages/dmarc-consumer/cdk.ts`: add a `SqsHandler` (`@beesolve/sqs-handler/cdk`)
      for the backfill worker pointing at the built `backfill/tasks.ts`, `timeout:
Duration.minutes(5)`. Grant it `this.table.grantReadWriteData` and set
      `IPINFO_API_KEY` (from `props.ipInfoApiKey`). Store the handler on the construct.
- [x] Add method `grantBackfill(lambda: LambdaFunction): void` calling the backfill
      `SqsHandler.grantAccess(lambda)`. Keep existing `grantRead`/`grantReadWrite`.
- [x] In `packages/dmarc-dashboard/cdk.ts`: call `props.consumer.grantBackfill(site.handler)`.
      Do NOT add `IPINFO_API_KEY` to the dashboard handler (it only reads the cache). Keep
      existing `props.consumer.grantReadWrite(site.handler)`.
- [x] CDK tests in `packages/dmarc-consumer/tests/cdk.test.ts`: assert the backfill queue + worker are synthesized and `grantBackfill` adds the queue-url env + send perm to a
      passed Lambda (follow existing cdk.test.ts assertions style).

**Files:** `packages/dmarc-consumer/cdk.ts`, `packages/dmarc-dashboard/cdk.ts`, `packages/dmarc-consumer/tests/cdk.test.ts`

**Acceptance criteria:** `bun test` (CDK synth assertions) passes; dashboard `tsconfig.cdk`
type-check passes.

---

### Task 7: Dashboard wiring — SDK service + domains-list button

- [x] In `packages/dmarc-dashboard/src/hooks.server.ts`: instantiate `BackfillSdk` once
      from `@beesolve/dmarc-consumer/sdk` with `{ dynamo, tableName: env.DMARC_TABLE_NAME }`
      and add to `event.locals.services.backfill`. Update `src/app.d.ts` accordingly.
- [x] In the domains list route (`src/routes/+page.server.ts`): call
      `locals.services.backfill.getBackfillStatuses({ domains })` in `load` and pass
      per-domain `{ canRun }` (+ optional last-run summary) to the page. Add a form
      `action` (default action, per the sveltekit-lambda named-action caveat — avoid
      named actions with `/` in the query) that calls
      `locals.services.backfill.startBackfill({ domain })` and returns the result.
- [x] In `src/routes/+page.svelte`: add a per-domain "Run backfill" button in each row,
      disabled when `canRun` is false (running), using a POST form to the action.
- [x] Ensure the dashboard builds with the new SDK import; if the vite SSR build surfaces
      an externals issue from `@aws-sdk/client-sqs`/`sqs-handler`, add it to `ssr.external`
      in `vite.config.ts` (per sveltekit-lambda steering).

**Files:** `packages/dmarc-dashboard/src/hooks.server.ts`, `packages/dmarc-dashboard/src/app.d.ts`, `packages/dmarc-dashboard/src/routes/+page.server.ts`, `packages/dmarc-dashboard/src/routes/+page.svelte`, `packages/dmarc-dashboard/vite.config.ts` (only if needed)

**Acceptance criteria:** `bun run type-check` (svelte-check) 0 errors; `bun run build`
succeeds; clicking the button (logic path) enqueues + gates correctly per SDK unit tests.

---

### Task 8: Changeset + final verification

- [x] Update `.changeset/ip-enrichment.md` (or add a second changeset) to describe both
      the enrichment refinement and the new backfill feature. Both packages get a `minor`
      bump: `@beesolve/dmarc-consumer` and `@beesolve/dmarc-dashboard`. Verify package
      names against each `package.json` `name` field before writing.
- [x] Run full gates across both packages: `bun run fmt`, `bun run lint`,
      per-package `bun run type-check`, `bun test`, and a full `bun run build`.
- [x] Confirm no SCAN anywhere; confirm dashboard does no ipinfo API calls at render
      (cache reads only); confirm enrichment/backfill are no-ops without `IPINFO_API_KEY`.

**Files:** `.changeset/ip-enrichment.md`

**Acceptance criteria:** all gates green repo-wide; changeset present with correct package
names + minor bumps.

## Future Work (out of scope)

- Optional cache staleness/refresh (documented in ADR-002 Future Work) — conditional
  put with `fetchedAt` cutoff, only if ASN/country drift becomes a concern.
- Persisting `IPINFO_API_KEY` in DB config + setup-form field + settings UI (explicitly
  deferred; key stays a CDK-injected env var for now).
- Live progress counts during backfill (only pending/started/finished/failed + final
  counts are tracked).
- Bulk ipinfo enrichment (the Lite API supports batch up to 1000/call) to reduce
  per-IP round-trips during large backfills.
- Reverse-DNS/PTR or MaxMind offline enrichment as alternatives/supplements to ipinfo.
