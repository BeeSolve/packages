# DMARC Dashboard UX Reframe + DNS Setup Advisory

## Status: In Progress

## Problem Statement

Three pieces of UX feedback on the DMARC dashboard (`packages/dmarc-dashboard`), plus one supporting data-layer change in `@beesolve/dmarc-consumer`:

1. **"Refresh IP details" is over-exposed.** On the domain overview (`src/routes/+page.svelte`) an entire column titled "Sender origins" and a page-level hint are dedicated to a manual IP-enrichment/backfill button. But source IPs are already auto-enriched on ingest (`packages/dmarc-consumer/src/consumer.ts` → `enrichSourceIps`), so for freshly set-up domains this action is redundant in the common case. It's a maintenance/backfill action occupying prime real estate. It should be relocated to the domain detail page — next to the Source IP table where the enrichment data is actually consumed — and removed from the overview list.

2. **The "Pass Rate" metric is semantically inverted and alarming.** `report.ts` `toItem()` defines `totalFail` as messages where `disposition !== "none"` (quarantined/rejected) and `totalPass` as everything else. So the headline "Pass Rate" is really "percentage of mail DMARC did NOT act on." A domain being heavily spoofed shows a low "pass rate" colored red (`statusBadge.svelte`: `<80 → red`), which reads as "something is broken" when in fact DMARC is correctly rejecting spoofed mail — a good outcome. We need to stop alarm-coloring the raw disposition rate, lead with metrics that are genuinely "high is good", and positively frame blocked spoofing. We also need to surface the actually-worrying case (auth failing but policy `p=none`, so nothing is blocked).

3. **Misconfiguration / too-lax setup detection.** We can help users fix DNS problems. We have two evidence sources: (a) observed report behavior (policy `p`, `pct`, verdict breakdown, alignment failures of real senders — already computed in `src/lib/server/aggregate.ts`), and (b) **live DNS**, fetched with Node's built-in `node:dns/promises` (all Lambdas run `Runtime.NODEJS_24_X` via `Nodejs24Function`; the dashboard SSR runs on Node 24). We fetch and validate the actual `_dmarc`, SPF, and DKIM (for observed selectors) TXT records and surface actionable guidance.

The DNS records are cached on the existing **domain record** in DynamoDB (same single-table pattern used everywhere), stored as an **optional** field so the change is backward compatible. Each cache entry carries a `fetchedAt` timestamp; staleness is computed against a globally configured TTL (default 24h). All DNS fetching and writing happens **out of band in an SQS task worker** (mirroring the existing IP-backfill pattern) — never inline in the SSR request path. Fetches are triggered three ways: (a) a **daily EventBridge cron** that fans out one `refreshDomainDns` SQS task per stale domain, (b) a **first-time bootstrap** enqueue when a domain aggregate is first created during report ingest, and (c) an **on-demand refresh button** in the dashboard that enqueues a forced `refreshDomainDns` task. The SSR page only ever _reads_ the cached `dns` field. Note on TTL: Node's `node:dns/promises` `resolveTxt()` does not expose per-record DNS TTLs (`{ ttl: true }` is only supported for A/AAAA lookups), so we use our own configurable staleness window (default 24h) rather than the DNS-published TTL.

## Architecture / Approach

### Types and Schemas

**DNS cache on the domain record** — extend `packages/dmarc-consumer/domain.ts` `schema` with an optional `dns` field (backward compatible: existing records without it parse fine):

```ts
// packages/dmarc-consumer/domain.ts
export const spfMechanismSchema = v.object({
  raw: v.string(), // the full SPF TXT record
  all: v.optional(v.picklist(spfAllQualifiers)), // "-all" | "~all" | "?all" | "+all"
  lookupCount: v.optional(v.number()), // count of include/a/mx/ptr/exists/redirect
  valid: v.boolean(), // parsed as a v=spf1 record at all
});

export const spfAllQualifiers = ["-all", "~all", "?all", "+all"] as const;
export type SpfAllQualifier = (typeof spfAllQualifiers)[number];

export const dmarcRecordDnsSchema = v.object({
  raw: v.string(), // the _dmarc TXT record
  policy: v.optional(v.picklist(dmarcPolicies)), // p=
  subdomainPolicy: v.optional(v.picklist(dmarcPolicies)), // sp=
  pct: v.optional(v.number()),
  adkim: v.optional(v.picklist(alignmentModes)), // "r" | "s"
  aspf: v.optional(v.picklist(alignmentModes)),
  rua: v.optional(v.array(v.string())),
  valid: v.boolean(), // parsed as a v=DMARC1 record
});

export const dmarcPolicies = ["none", "quarantine", "reject"] as const;
export const alignmentModes = ["r", "s"] as const;

export const dkimSelectorSchema = v.object({
  selector: v.string(),
  found: v.boolean(), // a key was present at <selector>._domainkey.<domain>
  raw: v.optional(v.string()),
});

export const domainDnsSchema = v.object({
  fetchedAt: v.string(), // ISO timestamp — drives staleness
  spf: v.optional(spfMechanismSchema),
  dmarc: v.optional(dmarcRecordDnsSchema),
  dkimSelectors: v.optional(v.array(dkimSelectorSchema)),
  error: v.optional(v.string()), // last fetch error, if any (records ENODATA etc.)
});
export type DomainDns = v.InferOutput<typeof domainDnsSchema>;

export const schema = v.object({
  pk: v.string(),
  sk: v.literal("domain"),
  domain: v.string(),
  totalMessages: v.number(),
  totalPass: v.number(),
  totalFail: v.number(),
  dns: v.optional(domainDnsSchema), // NEW — optional, backward compatible
});
```

Note the beesolve Valibot convention: string-literal unions use `v.picklist` with an `as const` array, never `v.union([v.literal(...)])`.

**Setup advisory** (dashboard-side, `src/lib/server/advisory.ts`) — a pure function that combines the DNS record with the report-derived aggregate to produce a list of findings:

```ts
export const advisorySeverities = ["ok", "info", "warning", "critical"] as const;
export type AdvisorySeverity = (typeof advisorySeverities)[number];

export interface AdvisoryFinding {
  id: string; // stable id, e.g. "policy-none", "spf-softfail"
  severity: AdvisorySeverity;
  title: string; // short, plain-language
  detail: string; // what's wrong and the concrete fix
}

export function buildAdvisory(props: {
  dns?: DomainDns;
  aggregate: DomainAggregate;
}): Array<AdvisoryFinding>;
```

### Public API Surface

`@beesolve/dmarc-consumer/domain` (extended):

- `parseDmarcRecord(txt: string): DmarcRecordDns` — parse a `_dmarc` TXT string.
- `parseSpfRecord(txt: string): SpfMechanism` — parse an SPF TXT string (qualifier + lookup count).
- `Domains.getByDomain({ domain }): Promise<Domain | null>` — fetch a single domain record (new; currently only `list()` exists).
- `Domains.putDns({ domain, dns }): Promise<void>` — write the `dns` field via `UpdateCommand SET #dns = :dns` (does not disturb the `ADD` counters).
- `Domains.clearDns({ domain }): Promise<void>` — `UpdateCommand REMOVE #dns` (kept for completeness; not on the primary path).

New DNS resolver module `@beesolve/dmarc-consumer/dns` (`packages/dmarc-consumer/dns.ts`):

- `resolveDomainDns({ domain, dkimSelectors }): Promise<DomainDns>` — uses `node:dns/promises` (`resolveTxt`) to fetch `_dmarc.<domain>`, `<domain>` (SPF), and `<selector>._domainkey.<domain>` for each observed selector; parses each; sets `fetchedAt`; captures per-record resolution errors into `error`/`found:false` rather than throwing. **Pure of Dynamo** — no cache/DB access. This is the only network-touching function; it is invoked exclusively from the SQS worker (`runDnsRefresh`), never from SSR.
- `isDnsStale({ dns, ttlMs }): boolean` — small pure helper: `dns == null || dns.fetchedAt == null || Date.now() - Date.parse(dns.fetchedAt) > ttlMs`. Used by the cron to decide which domains to enqueue.

**No `DnsCache` read-through class.** DNS is fetched and written only in the worker path below; SSR reads the cached field via `Domains.getByDomain`.

Generalized job-run tracker (refactor of `backfill.ts`) — `@beesolve/dmarc-consumer` internal:

- The existing `Backfill` run-state machine (`startRun`/`completeRun`/`failRun`/`deriveCanRun` + config item + `run#<...>` history) is generalized to be parameterized by a **job kind** (`ipBackfill` | `dnsRefresh`). Distinct config `sk` per kind and distinct run-history `pk` prefixes per kind keep the two job types isolated in the single table. The DNS-refresh job reuses the identical `canRun`/`lastRun`/stale-run semantics.

New DNS worker module (`packages/dmarc-consumer/src/runDnsRefresh.ts`, mirrors `src/runBackfill.ts`):

- `runDnsRefresh({ reports, domains, jobs, domain, runId })` — derives observed DKIM selectors by scanning the domain's stored reports (via `Reports`, same source the backfill uses), calls `resolveDomainDns`, `domains.putDns`, and marks the run finished/failed via the job tracker.

New SQS task (`packages/dmarc-consumer/src/tasks.ts`):

- `refreshDomainDns({ domain, runId })` — added alongside the existing `backfillDomain` task in the same `createSqsHandlers` map; delegates to `runDnsRefresh`.

New cron enqueue handler (`packages/dmarc-consumer/src/dnsCron.ts`, wired to a daily EventBridge rule):

- reads `domains.list()`, filters to those where `isDnsStale({ dns, ttlMs })`, and enqueues one `refreshDomainDns` task per stale domain (via the same `tasks` client). TTL from `DNS_CACHE_TTL_MS` env (default 24h).

SDK — **rename `BackfillSdk` → `AdminSdk`** (`packages/dmarc-consumer/sdk.ts`), one class covering both concerns:

- `startIpBackfill({ domain })` (renamed from `start`) / `getIpBackfillStatuses()` (renamed from `getStatuses`).
- `startDnsRefresh({ domain }): Promise<{ enqueued: true; runId } | { enqueued: false; reason: "already-running" }>` — guarded `startRun` against the `dnsRefresh` job kind, enqueues `refreshDomainDns`, mirrors the backfill start semantics (force w.r.t. the DNS TTL — a manual refresh always fetches).
- `getDnsRefreshStatuses(): Promise<Record<string, JobStatusSummary>>` — full backfill-style `canRun`/`lastRun` per domain for the DNS-refresh job.

`@beesolve/dmarc-dashboard` `src/lib/server/advisory.ts`:

- `buildAdvisory(...)` as above.

### Cross-Package Dependencies

- No new external dependencies. `node:dns/promises` is built into Node 24. The dashboard already depends on `@beesolve/dmarc-consumer` (`workspace:^`).
- New package export `./dns` must be added to `packages/dmarc-consumer/package.json` `exports` (mirror the existing `./domain`, `./ip-info` entries) and to the barrel/build (`build.ts`/bunup entry list — check how `ipInfo.ts` is exposed and follow the same wiring).
- The dashboard `hooks.server.ts` wires a read-only `Domains` accessor plus the `AdminSdk` into `event.locals.services` (single-instantiation pattern — never instantiate in route files). SSR does **not** instantiate a resolver or cache. The staleness TTL lives on the consumer/cron side (`DNS_CACHE_TTL_MS`), not in the dashboard; the dashboard only reads `dns.fetchedAt` to render "last checked" / stale hints.

### CDK Constructs

**One new EventBridge rule** (daily schedule) targeting a small cron Lambda that enqueues stale-domain DNS refreshes. The DNS worker itself is **not** a new function — `refreshDomainDns` is added to the existing `tasks/` SqsHandler (`this.backfill` in `cdk.ts`), which already has table read/write. The cron Lambda needs table read (`domains.list()`) and permission to enqueue to the tasks main queue (`SqsHandler.grantAccess` / the queue URL env). No new tables — the DNS cache lives on the existing domain item. Lambda egress for outbound DNS works by default (functions are not VPC-attached; the ipinfo HTTP lookups already make outbound calls). No IAM changes needed for DNS resolution itself.

### Key Design Decisions

- **DNS cache lives on the domain record as an optional field**, per the user's explicit instruction — not a separate cache item. Backward compatible because `dns` is `v.optional`. Written with a targeted `SET #dns` update so it never interferes with the `ADD` counter updates in `upsert`.
- **All DNS fetching/writing happens in an SQS worker**, never inline in SSR. Node `resolveTxt` can be slow or hang; keeping it off the request path avoids API Gateway/CloudFront timeouts and matches the existing IP-backfill architecture (`runBackfill` → `tasks` → `SqsHandler`). SSR is strictly read-only (`Domains.getByDomain`).
- **Three fetch triggers:** (a) **daily EventBridge cron** fans out one `refreshDomainDns` task per _stale_ domain (`isDnsStale` against the 24h TTL) — daily cron + 24h TTL means each domain refetches ~daily but the cron is a no-op for anything still fresh; (b) **first-time bootstrap** — when a domain aggregate is first created in `consumer.ts upsertDomainAggregates`, enqueue a `refreshDomainDns` so new domains get DNS immediately without waiting for the nightly sweep and without inline DNS on the ingest hot path (fire-and-forget enqueue); (c) **on-demand button** — enqueues a forced `refreshDomainDns` (ignores TTL) via `AdminSdk.startDnsRefresh`.
- **Internal 24h staleness TTL, not the DNS-published TTL.** `resolveTxt` does not return per-record TTL (`{ ttl: true }` is A/AAAA only). Reading real TXT TTLs would require raw DNS queries / a new dependency, which the user declined. We use a configurable `DNS_CACHE_TTL_MS` (default 24h) instead.
- **On-demand refresh uses the full backfill-style job tracker** (`canRun`/`lastRun`/stale-run recovery), sharing one generalized run-state machine across both `ipBackfill` and `dnsRefresh` job kinds rather than duplicating `backfill.ts`. **The daily cron and the first-time bootstrap both enqueue through the same guarded `startRun`** — the tracker's `already-running` condition is the single point that prevents the cron, the bootstrap, and a manual button from double-starting a run for the same domain (settled decision; the cron is not an unconditional enqueue).
- **Single `AdminSdk`** (renamed from `BackfillSdk`) owns both IP-backfill and DNS-refresh start/status methods — one SDK instead of two near-identical small ones. **This is a clean rename with no deprecated `BackfillSdk` alias.** The package is in beta (`0.x`), so the breaking rename ships as a **minor** bump per semver.
- **Single default form action + hidden `intent` field** (`refresh-dns` | `refresh-ips`) on the domain detail page. SvelteKit named actions use `?/name`, and the `/` breaks behind CloudFront/Lambda (per `sveltekit-lambda` steering), so we avoid named actions entirely and branch on `intent`.
- **DKIM selectors are observation-driven.** DNS can't enumerate arbitrary selectors, so the worker queries exactly the selectors observed in that domain's stored reports (`authResults.dkim[].selector`, already parsed by `dmarc-parser`) — derived inside `runDnsRefresh`, not passed from SSR.
- **Pass-rate reframe favors clarity over renaming only.** The headline stops using alarm colors for the disposition rate. We lead with SPF/DKIM auth health (genuinely "high is good") and a positively-framed "Spoofing Blocked" figure, and add an advisory note when auth is failing under `p=none`.
- **DNS parsing is pure and unit-tested**; network resolution is isolated in `resolveDomainDns` so parsers can be tested without DNS.
- **All findings degrade gracefully** — if DNS resolution fails (no record, NXDOMAIN, timeout), the advisory still renders report-derived findings and notes DNS could not be read, rather than erroring the page.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check`
3. `bun test`

For the dashboard package specifically, also run its type-check (`bun run --filter @beesolve/dmarc-dashboard check` / `svelte-check` if present) to catch Svelte/`+page.server.ts` type errors.

**Rules for subagents:**

- Each task must be self-contained.
- No commits — leave changes uncommitted for review.
- Follow project code style (`.kiro/steering/`): no narrating comments, `== null`/`!= null` for nullish checks, `v.picklist` for string-literal unions, `import type` for type-only imports, descriptive full variable names in array callbacks, named object params for 3+ args.
- Use `workspace:^` for intra-monorepo deps; `catalog:` for shared external deps.
- Run `bun install` after adding dependencies; `bun run recalculate-dependencies` after changing intra-monorepo deps.
- Package names differ from directory names — read `package.json` `name` before creating changesets. `packages/dmarc-consumer/` → `@beesolve/dmarc-consumer`; `packages/dmarc-dashboard/` → read its `package.json` (likely `@beesolve/dmarc-dashboard`).
- SvelteKit services are instantiated once in `hooks.server.ts` and accessed via `event.locals.services.*` — never instantiate clients/services in route files.

**Operational notes:**

- Build tool is bunup. Package public API for `dmarc-consumer` is exposed via per-module `exports` in `package.json` (`./domain`, `./ip-info`, etc.) — new modules need a new `exports` entry and build wiring. Check `packages/dmarc-consumer/build.ts` and follow the existing pattern for `ipInfo.ts`.
- Create/extend ADRs in `packages/dmarc-consumer/docs/` for the DNS-on-domain-record decision.

## Tasks

### Task 1: DNS record parsers + schema on the domain record

- [x] In `packages/dmarc-consumer/domain.ts`, add the schemas: `spfAllQualifiers`/`SpfAllQualifier`, `spfMechanismSchema`, `dmarcPolicies`, `alignmentModes`, `dmarcRecordDnsSchema`, `dkimSelectorSchema`, `domainDnsSchema`/`DomainDns` (all as specified in Architecture → Types and Schemas). Use `v.picklist` with `as const` arrays for literal unions. (Schemas/types moved to dedicated `dnsRecord.ts` module — repository file `domain.ts` stays pure data-access.)
- [x] Extend the existing `schema` with `dns: v.optional(domainDnsSchema)`. Confirm existing stored records (without `dns`) still parse (optional field).
- [x] Add pure parsers in a dedicated `dnsRecord.ts` module (not the repository file `domain.ts`):
  - `parseSpfRecord(txt: string): SpfMechanism` — detect `v=spf1`, extract the trailing `all` qualifier (`-all`/`~all`/`?all`/`+all`), count DNS-lookup mechanisms (`include:`, `a`, `mx`, `ptr`, `exists:`, `redirect=`) for the 10-lookup guidance, set `valid`.
  - `parseDmarcRecord(txt: string): DmarcRecordDns` — detect `v=DMARC1`, parse `p`, `sp`, `pct` (number), `adkim`, `aspf`, `rua` (split addresses), set `valid`.
- [x] Export all new types, schemas, and parsers (via new `./dns-record` package export entry).
- [x] Include tests: `packages/dmarc-consumer/tests/dnsParse.test.ts` — assert parsing of representative SPF records (`-all`, `~all`, over-10-lookups), a `p=reject; pct=100; adkim=s` DMARC record, a `p=none` record, and malformed/non-matching strings (`valid:false`).

**Files:** `packages/dmarc-consumer/domain.ts` (+ optional `dnsParse.ts`), `packages/dmarc-consumer/tests/dnsParse.test.ts`

**Acceptance criteria:** New parser tests pass; existing `packages/dmarc-consumer/tests/domain.test.ts` still passes (schema change is additive/optional); `bun run type-check` clean.

---

### Task 2: Domain record accessors for the DNS field

- [ ] In `packages/dmarc-consumer/domain.ts` `Domains` class, add:
  - `getByDomain({ domain }): Promise<Domain | null>` — `GetCommand` on `Key: { pk: \`domain#${domain}\`, sk: "domain" }`, parse via existing `parseOne`, return `null` when absent.
  - `putDns({ domain, dns }: { domain: string; dns: DomainDns }): Promise<void>` — `UpdateCommand` with `UpdateExpression: "SET #dns = :dns"`, `ExpressionAttributeNames: { "#dns": "dns" }`, `ExpressionAttributeValues: { ":dns": dns }`. Must NOT touch the counter fields.
  - `clearDns({ domain }): Promise<void>` — `UpdateCommand` with `UpdateExpression: "REMOVE #dns"`, `ExpressionAttributeNames: { "#dns": "dns" }`.
- [ ] Keep the existing `upsert`/`list`/`parseOne` behavior unchanged.
- [ ] Include tests: extend `packages/dmarc-consumer/tests/domain.test.ts` — assert `getByDomain` parses a returned item and returns null on empty; `putDns` sends the correct `SET #dns` expression and value; `clearDns` sends `REMOVE #dns`.

**Files:** `packages/dmarc-consumer/domain.ts`, `packages/dmarc-consumer/tests/domain.test.ts`

**Acceptance criteria:** New accessor tests pass; check gates clean.

---

### Task 3: DNS resolver (`dns.ts`) — pure resolution + parsing, no cache

- [ ] Create `packages/dmarc-consumer/dns.ts`.
- [ ] `resolveDomainDns({ domain, dkimSelectors }: { domain: string; dkimSelectors: Array<string> }): Promise<DomainDns>`:
  - Use `import { resolveTxt } from "node:dns/promises"`.
  - Resolve `_dmarc.<domain>` → join TXT chunks → `parseDmarcRecord`.
  - Resolve `<domain>` → find the `v=spf1` record → `parseSpfRecord`.
  - For each selector in `dkimSelectors`, resolve `<selector>._domainkey.<domain>` → `{ selector, found: true, raw }`, or `{ selector, found: false }` on `ENODATA`/`ENOTFOUND`.
  - Set `fetchedAt: new Date().toISOString()`. Catch per-lookup errors so one failing lookup doesn't abort the others; record a top-level `error` string only when the whole resolution is unusable.
  - **No Dynamo access** — this function only resolves + parses.
- [ ] `isDnsStale({ dns, ttlMs }: { dns?: DomainDns; ttlMs: number }): boolean` — pure: `true` when `dns == null`, `dns.fetchedAt == null`, or `Date.now() - Date.parse(dns.fetchedAt) > ttlMs`.
- [ ] Add `./dns` to `packages/dmarc-consumer/package.json` `exports` (mirror `./ip-info`) and wire into the build (`build.ts`/bunup entries — follow how `ipInfo.ts` is built).
- [ ] Include tests: `packages/dmarc-consumer/tests/dns.test.ts` — unit-test `isDnsStale` (null, missing `fetchedAt`, fresh, stale). Keep `resolveDomainDns` network calls out of the tests (it is exercised via the worker path). Optionally test the per-lookup error mapping by injecting a stub resolver if `resolveDomainDns` is written to accept an optional resolver override.

**Files:** `packages/dmarc-consumer/dns.ts`, `packages/dmarc-consumer/package.json`, `packages/dmarc-consumer/build.ts`, `packages/dmarc-consumer/tests/dns.test.ts`

**Acceptance criteria:** `isDnsStale` tests pass; `./dns` export resolves in a type-check; check gates clean.

---

### Task 4: Generalize the job-run tracker + rename SDK to `AdminSdk`

- [ ] In `packages/dmarc-consumer/backfill.ts`, generalize the run-state machine so it is parameterized by a **job kind** (`ipBackfill` | `dnsRefresh`):
  - Introduce `jobKinds = ["ipBackfill", "dnsRefresh"] as const` + `JobKind` type (`v.picklist`).
  - The config item `sk` becomes kind-specific (e.g. `sk: "ipBackfill"` / `sk: "dnsRefresh"`), and the run-history `pk` prefix becomes kind-specific (e.g. `backfill#<domain>` for ip, `dnsRefresh#<domain>` for dns). Keep `startRun`/`completeRun`/`failRun`/`deriveCanRun` shared, taking the kind (and, for backfill, the existing `ipsEnriched`/`reportsScanned` counters remain; DNS runs can omit them or record a `selectorsChecked` count — keep counters optional).
  - Preserve existing `ipBackfill` behavior exactly (same `sk`/`pk` values it uses today) so stored records and the existing overview flow are unaffected. Consider keeping a thin `Backfill`-compatible surface or updating call sites in the same task.
- [ ] Rename `BackfillSdk` → `AdminSdk` in `packages/dmarc-consumer/sdk.ts`. **Clean rename — do NOT keep a deprecated `BackfillSdk` re-export alias** (we are the sole consumer, so breaking changes are accepted; this drives the major bump in Task 12). Remove the `BackfillSdk` name entirely from the export, the build entry, and all importers.
  - `startIpBackfill` (was `start`), `getIpBackfillStatuses` (was `getStatuses`) — same behavior, `ipBackfill` kind.
  - `startDnsRefresh({ domain })` — guarded `startRun` for `dnsRefresh` kind; on success enqueue `tasks.refreshDomainDns({ domain, runId })`; return `{ enqueued, runId } | { enqueued: false, reason: "already-running" }`.
  - `getDnsRefreshStatuses()` — `canRun`/`lastRun` per domain for `dnsRefresh` kind.
- [ ] Update the export name in `package.json`/build if the SDK module is exported by a named entry. Update any existing importers of `BackfillSdk` (the dashboard `+page.server.ts`) to `AdminSdk`.
- [ ] Include tests: extend `packages/dmarc-consumer/tests/backfill.test.ts` (or add `tests/adminSdk.test.ts`) — assert the `dnsRefresh` kind uses distinct keys, `deriveCanRun` semantics match, and `startDnsRefresh` enqueues the right task. Existing backfill tests must still pass.

**Files:** `packages/dmarc-consumer/backfill.ts`, `packages/dmarc-consumer/sdk.ts`, `packages/dmarc-consumer/package.json`/`build.ts` (if export name changes), `packages/dmarc-consumer/tests/*`

**Acceptance criteria:** Existing backfill/SDK tests pass unchanged in behavior; new `dnsRefresh`-kind tests pass; `AdminSdk` exported and importers updated; check gates clean.

---

### Task 5: DNS refresh worker + SQS task + daily cron enqueue

- [ ] Create `packages/dmarc-consumer/src/runDnsRefresh.ts` (mirror `src/runBackfill.ts`):
  - `runDnsRefresh({ reports, domains, jobs, domain, runId }): Promise<void>` — derive observed DKIM selectors by scanning the domain's stored reports (via `Reports`, same source `runBackfill` uses for IPs; collect unique `authResults.dkim[].selector`), call `resolveDomainDns({ domain, dkimSelectors })`, `domains.putDns({ domain, dns })`, then mark the run `finished` (or `failed` with the error) via the generalized tracker for the `dnsRefresh` kind.
- [ ] In `packages/dmarc-consumer/src/tasks.ts`, add `refreshDomainDns: async ({ domain, runId }) => runDnsRefresh({ ... })` to the existing `createSqsHandlers` `functions` map (alongside `backfillDomain`). Instantiate the shared `Domains`/job tracker there (already has `reports`).
- [ ] Create `packages/dmarc-consumer/src/dnsCron.ts` — an EventBridge-triggered handler: parse env (`TABLE_NAME`, `REVERSE_INDEX_NAME`, `DNS_CACHE_TTL_MS?`, tasks queue url), `domains.list()`, filter with `isDnsStale({ dns: domain.dns, ttlMs })`, enqueue `tasks.refreshDomainDns({ domain, runId })` for each stale domain. **Decision (settled): the cron goes through the same guarded `startRun` (the tracker's `already-running` condition) rather than enqueuing unconditionally** — this way the daily cron and a manual "Refresh DNS" button cannot both start a run for the same domain. This mirrors the IP-backfill guard and is intentional; the cron is NOT dumbed down to unconditional enqueue.
- [ ] In `packages/dmarc-consumer/cdk.ts`: add a daily `Rule` (`Schedule.rate(Duration.days(1))`) targeting a new `Nodejs24Function` for `dnsCron.ts` (entry/handler like the others). Grant it table read + tasks-queue enqueue access (`this.backfill.grantAccess(cronFn)` + `TABLE_NAME`/`REVERSE_INDEX_NAME`/`BEESOLVE_TASKS_MAIN_QUEUE_URL` envs). Wire the cron function's build entry the same way the `tasks/` and `consumer/` entries are built.
- [ ] Include tests: `packages/dmarc-consumer/tests/dnsCron.test.ts` (or extend an existing suite) — with an in-memory `domains.list()` returning a mix of fresh/stale/`dns`-missing records, assert only stale/missing domains get enqueued. Stub the resolver/enqueue.

**Files:** `packages/dmarc-consumer/src/runDnsRefresh.ts`, `packages/dmarc-consumer/src/tasks.ts`, `packages/dmarc-consumer/src/dnsCron.ts`, `packages/dmarc-consumer/cdk.ts`, `packages/dmarc-consumer/build.ts` (cron entry), `packages/dmarc-consumer/tests/dnsCron.test.ts`

**Acceptance criteria:** Cron enqueues only stale/missing domains; `refreshDomainDns` worker resolves + writes `dns` + marks the run; CDK synthesizes (daily rule + cron fn present); check gates clean.

---

### Task 6: First-time DNS bootstrap on new-domain ingest

- [ ] In `packages/dmarc-consumer/src/consumer.ts` `upsertDomainAggregates`: detect when a domain aggregate is created for the **first time** (e.g. `upsert` returns/reports the pre-update absence, or a follow-up `getByDomain` shows no `dns`), and enqueue `tasks.refreshDomainDns({ domain, runId })` for that domain (guarded via the `AdminSdk`/tracker so a concurrent refresh isn't double-started). Fire-and-forget: swallow+log enqueue errors so ingest never fails on it — mirror the error handling around `enrichSourceIps`.
- [ ] Wire the `tasks` client / `AdminSdk` into `consumer.ts` (it currently has `domains`; add the enqueue path and the `BEESOLVE_TASKS_MAIN_QUEUE_URL` env to the consumer's `envSchema` + CDK `Consumer` environment + queue grant).
- [ ] Include tests: extend `packages/dmarc-consumer/tests/consumer.test.ts` (or the relevant suite) — assert a brand-new domain triggers exactly one `refreshDomainDns` enqueue and an already-known domain does not.

**Files:** `packages/dmarc-consumer/src/consumer.ts`, `packages/dmarc-consumer/cdk.ts` (consumer queue-enqueue grant + env), `packages/dmarc-consumer/tests/consumer.test.ts`

**Acceptance criteria:** New domains enqueue one DNS refresh; existing domains don't; ingest still succeeds if enqueue fails; check gates clean.

---

### Task 7: ADR for DNS worker/cron + on-domain-record cache decision

- [ ] Create `packages/dmarc-consumer/docs/adr-002-dns-cache-on-domain-record.md` following the repo ADR format (Status/Context/Decision/Rationale/Consequences/Alternatives Considered).
- [ ] Capture: DNS cached on the domain record (single-table, backward-compatible optional field) vs a separate cache item; **out-of-band SQS worker + daily cron + first-time bootstrap + on-demand button** (why not inline in SSR); **internal 24h TTL instead of DNS-published TTL** (`resolveTxt` has no TTL, raw-query dependency declined); generalized job-run tracker shared with IP backfill; observation-driven DKIM selectors.

**Files:** `packages/dmarc-consumer/docs/adr-002-dns-cache-on-domain-record.md`

**Acceptance criteria:** ADR exists, numbered, follows the format. (No code — no check-gate impact.)

---

### Task 8: Setup advisory builder (dashboard, pure function + tests)

- [ ] Create `packages/dmarc-dashboard/src/lib/server/advisory.ts` with `advisorySeverities`, `AdvisorySeverity`, `AdvisoryFinding`, and `buildAdvisory({ dns, aggregate }): Array<AdvisoryFinding>`.
- [ ] Findings to implement (each with a stable `id`, `severity`, plain-language `title`, and an actionable `detail`):
  - `policy-none` (warning): `dns.dmarc.policy === "none"` AND aggregate shows failing-but-unactioned volume (`suspicious` verdicts / `totalFail === 0` while SPF/DKIM pass rates are low) → advise moving to `quarantine` then `reject` after verifying senders.
  - `policy-missing` (critical): no valid `_dmarc` record → advise publishing one.
  - `pct-partial` (info): `dns.dmarc.pct != null && dns.dmarc.pct < 100` → policy applies to a fraction of mail.
  - `spf-softfail` (info/warning): `dns.spf.all` is `~all`/`?all`/`+all` → consider `-all` once senders verified; `+all` is critical.
  - `spf-lookups` (warning): `dns.spf.lookupCount != null && dns.spf.lookupCount > 10` → SPF exceeds the 10-DNS-lookup limit; flatten includes.
  - `spf-missing` (warning): no valid SPF record.
  - `dkim-selector-missing` (warning): a selector in `dns.dkimSelectors` with `found:false` that is actively signing (present in observed selectors) → publish/repair the DKIM key.
  - `spoofing-blocked` (ok/info, positive framing): high `aggregate.spoofingAttempts` → DMARC is correctly rejecting spoofed mail.
  - `dns-unavailable` (info): `dns == null || dns.error != null` → could not read DNS; findings limited to report-derived signals.
- [ ] Keep it a pure function (no I/O). Import `DomainAggregate` from `$lib/server/aggregate.js` and `DomainDns` from `@beesolve/dmarc-consumer/domain`.
- [ ] Include tests: `packages/dmarc-dashboard/tests/advisory.test.ts` (or the dashboard's test dir convention) — cover each finding’s trigger and non-trigger, and the graceful `dns == null` path.

**Files:** `packages/dmarc-dashboard/src/lib/server/advisory.ts`, `packages/dmarc-dashboard/tests/advisory.test.ts`

**Acceptance criteria:** Advisory tests pass; `buildAdvisory` is pure; check gates clean.

---

### Task 9: Wire read-only DNS + `AdminSdk` into dashboard hooks + domain detail load/actions

- [ ] In `packages/dmarc-dashboard/src/hooks.server.ts`: import `AdminSdk` from `@beesolve/dmarc-consumer` (whatever entry exports the SDK) and ensure a `Domains` instance is available. Add `adminSdk` (replacing any existing backfill SDK instance) to `event.locals.services`; keep the single-instantiation pattern. The dashboard does **not** instantiate any DNS resolver/cache. Update the `App.Locals` services type (`src/app.d.ts` or wherever `services` is typed) — rename the backfill service to `adminSdk` and drop any `dnsCache`.
- [ ] In `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts` `load`: read the cached DNS via `const domainRecord = await locals.services.domains.getByDomain({ domain: params.domain })` (or expose a small read on an existing service) and pull `domainRecord?.dns`. Compute `const advisory = buildAdvisory({ dns: domainRecord?.dns, aggregate })`. Also surface DNS-refresh status for the button (`locals.services.adminSdk.getDnsRefreshStatuses()` → this domain's `canRun`/`lastRun`). Add `dns`, `advisory`, and the DNS-refresh status to the returned data. Enforce the existing access check.
- [ ] **Single default form action with a hidden `intent` field** (no named actions — avoids `?/name` behind CloudFront):
  - The `default` action reads `intent` from the submitted form data: `"refresh-dns"` → `locals.services.adminSdk.startDnsRefresh({ domain })`; `"refresh-ips"` → `locals.services.adminSdk.startIpBackfill({ domain })`.
  - Enforce the same access check as `load` (`user.type !== "admin" && !user.domains.includes(domain)` → 403). Return the enqueue result (including the `already-running` case → 409-style form fail) so the UI can reflect state.

**Files:** `packages/dmarc-dashboard/src/hooks.server.ts`, `packages/dmarc-dashboard/src/app.d.ts`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`

**Acceptance criteria:** Dashboard type-check passes; `load` returns cached `dns` + `advisory` + DNS-refresh status (no inline resolution); the single default action branches on `intent` for both DNS-refresh and IP-backfill enqueues with access checks. Check gates clean.

---

### Task 10: Domain detail UI — advisory panel, relocated Refresh IP details, DNS refresh

- [ ] In `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`:
  - Add a "Setup health" section/card near the top that renders `data.advisory` findings, color-coded by severity (`ok`→success, `info`→neutral, `warning`→warning, `critical`→error), each showing `title` + `detail`. Use existing token conventions (`--success`/`--warning`/`--error`, graffiti `.tag`/`.callout`).
  - Show the resolved DNS summary (policy `p`, `pct`, SPF `all` qualifier, DKIM selectors found) compactly, with a **"Refresh DNS"** button. The button submits the page's single **default** form action with a hidden `<input name="intent" value="refresh-dns">`. It **enqueues** a background refresh (does not fetch inline) — reflect the enqueue + in-progress state from `data`'s DNS-refresh status (`canRun`/`lastRun`), mirroring the IP-backfill button UX. Show `data.dns.fetchedAt` as "last checked".
  - Relocate the **"Refresh IP details"** control here (from the overview): a small ghost button near the Source IPs tab header, submitting the same default action with hidden `<input name="intent" value="refresh-ips">`. Move the associated last-run status display and the explanatory hint text here too. Keep the `use:enhance` + submitting-state pattern from the current overview implementation.
  - Both buttons post to the same default action and are distinguished only by the hidden `intent` value — no named actions, no `?/` in the URL (CloudFront/Lambda constraint).
- [ ] Confirm the two enqueue paths and their status displays are wired to Task 9's `load` data and default action.

**Files:** `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`

**Acceptance criteria:** Advisory panel renders findings; DNS-refresh and IP-details-refresh both enqueue from the detail page via one default action + `intent`; in-progress/last-run states render; dashboard type-check + check gates clean.

---

### Task 11: Overview UI reframe — remove Refresh IP details, fix pass-rate framing

- [ ] In `packages/dmarc-dashboard/src/routes/+page.svelte`:
  - Remove the "Sender origins" column, the refresh `<form>`/button, the `last-run` display, the `.hint` paragraph, and the now-unused `enhance`/`submittingDomain` state.
  - Rename the "Pass Rate" summary card and the table column to a non-alarming label (e.g. "Delivered / not actioned"), OR replace with two clearer signals if aggregate data allows at overview level. At minimum: stop using `StatusBadge`'s red/amber thresholds on the disposition rate. If keeping a per-row indicator, use a neutral presentation for the disposition rate.
  - Keep the domain link, Messages, Pass, Fail columns.
- [ ] In `packages/dmarc-dashboard/src/routes/+page.server.ts`: remove the `default` backfill action and the `backfill.getStatuses()`/`canRun`/`lastRun` wiring from `load` (that concern now lives on the domain detail page). Keep the access-filtered domain list.
- [ ] Review `packages/dmarc-dashboard/src/lib/components/statusBadge.svelte` usage: it should only be applied to genuinely "high-is-good" metrics (SPF/DKIM auth health), not the disposition rate. Adjust where it's used accordingly (the per-report "Pass Rate" column on the detail page uses the same inverted metric — relabel/neutralize there too, or repoint the badge at an auth-health rate).

**Files:** `packages/dmarc-dashboard/src/routes/+page.svelte`, `packages/dmarc-dashboard/src/routes/+page.server.ts`, `packages/dmarc-dashboard/src/lib/components/statusBadge.svelte` (usage), `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte` (per-report Pass Rate relabel)

**Acceptance criteria:** Overview no longer shows Refresh IP details; disposition "pass rate" is no longer alarm-colored; domain list still renders and links work; dashboard type-check + check gates clean.

---

### Task 12: Changesets + end-to-end verification

- [ ] Read `packages/dmarc-consumer/package.json` and the dashboard `package.json` `name` fields. Create changesets: a **minor** bump for `@beesolve/dmarc-consumer` and an appropriate bump for the dashboard package. Do not assume package names match directory names.
  - **Decision (settled): clean `BackfillSdk` → `AdminSdk` rename, no deprecated `BackfillSdk` re-export alias.** The package is still in beta (`0.x`), so per semver there is no major to bump — breaking changes go in a **minor** bump. We are also the sole consumer, so the breaking rename is acceptable. Remove every `BackfillSdk` reference (export, importers, build entry) rather than aliasing.
  - The minor bump covers: the `AdminSdk` rename (breaking, but minor while `0.x`), plus the new `./dns` export, new domain accessors, optional `dns` schema field, generalized job tracker, and DNS worker/cron.
  - Document in the changeset body that `BackfillSdk` was renamed to `AdminSdk` and that `start`/`getStatuses` became `startIpBackfill`/`getIpBackfillStatuses`.
- [ ] Run full `bun run check`, `bun run type-check`, `bun test`, plus the dashboard's own type-check/svelte-check.
- [ ] Manually reason through the SvelteKit-on-Lambda constraints from steering: single default form action with `intent` (no `?/named` behind CloudFront), single service instantiation in hooks, and `@beesolve/lambda-fetch-api` SSR external (only relevant if touched).
- [ ] Sanity-check the new CDK: daily EventBridge rule + cron Lambda synthesize; cron has table-read + tasks-queue-enqueue grants; consumer has tasks-queue-enqueue grant for the bootstrap path.

**Files:** `.changeset/*.md`

**Acceptance criteria:** All check gates pass across the workspace; changesets present with correct package names and bump levels; CDK synthesizes with the new rule/function.

---

## Future Work (out of scope)

- Live DKIM key **validity** parsing (key type/length, `t=y` test flag) beyond presence detection.
- SPF include-chain flattening / actual recursive lookup resolution (current lookup count is a static parse of the record's own mechanisms).
- A dedicated "Setup" onboarding wizard that walks a user from `p=none` → `quarantine` → `reject`.
- Reading real DNS-published TTLs (requires raw DNS queries / a new dependency; currently a fixed configurable 24h staleness window).
- Surfacing advisory findings on the overview page (currently only on domain detail).
