# DMARC Dashboard UX Reframe + DNS Setup Advisory

## Status: Not Started

## Problem Statement

Three pieces of UX feedback on the DMARC dashboard (`packages/dmarc-dashboard`), plus one supporting data-layer change in `@beesolve/dmarc-consumer`:

1. **"Refresh IP details" is over-exposed.** On the domain overview (`src/routes/+page.svelte`) an entire column titled "Sender origins" and a page-level hint are dedicated to a manual IP-enrichment/backfill button. But source IPs are already auto-enriched on ingest (`packages/dmarc-consumer/src/consumer.ts` → `enrichSourceIps`), so for freshly set-up domains this action is redundant in the common case. It's a maintenance/backfill action occupying prime real estate. It should be relocated to the domain detail page — next to the Source IP table where the enrichment data is actually consumed — and removed from the overview list.

2. **The "Pass Rate" metric is semantically inverted and alarming.** `report.ts` `toItem()` defines `totalFail` as messages where `disposition !== "none"` (quarantined/rejected) and `totalPass` as everything else. So the headline "Pass Rate" is really "percentage of mail DMARC did NOT act on." A domain being heavily spoofed shows a low "pass rate" colored red (`statusBadge.svelte`: `<80 → red`), which reads as "something is broken" when in fact DMARC is correctly rejecting spoofed mail — a good outcome. We need to stop alarm-coloring the raw disposition rate, lead with metrics that are genuinely "high is good", and positively frame blocked spoofing. We also need to surface the actually-worrying case (auth failing but policy `p=none`, so nothing is blocked).

3. **Misconfiguration / too-lax setup detection.** We can help users fix DNS problems. We have two evidence sources: (a) observed report behavior (policy `p`, `pct`, verdict breakdown, alignment failures of real senders — already computed in `src/lib/server/aggregate.ts`), and (b) **live DNS**, fetched with Node's built-in `node:dns/promises` (all Lambdas run `Runtime.NODEJS_24_X` via `Nodejs24Function`; the dashboard SSR runs on Node 24). We fetch and validate the actual `_dmarc`, SPF, and DKIM (for observed selectors) TXT records and surface actionable guidance.

The DNS records are cached on the existing **domain record** in DynamoDB (same single-table pattern used everywhere), stored as an **optional** field so the change is backward compatible. Each cache entry carries a `fetchedAt` timestamp; on read, staleness is computed against a globally configured TTL (default 24h) and refetched + written back when stale. The cache is **purgable from the frontend** so a user who just changed DNS can force a refetch.

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
- `Domains.clearDns({ domain }): Promise<void>` — `UpdateCommand REMOVE #dns` for frontend purge.

New DNS resolver module `@beesolve/dmarc-consumer/dns` (`packages/dmarc-consumer/dns.ts`):

- `resolveDomainDns({ domain, dkimSelectors }): Promise<DomainDns>` — uses `node:dns/promises` (`resolveTxt`) to fetch `_dmarc.<domain>`, `<domain>` (SPF), and `<selector>._domainkey.<domain>` for each observed selector; parses each; sets `fetchedAt`; captures per-record resolution errors into `error`/`found:false` rather than throwing.
- `DnsCache` class (mirrors `IpInfoCache` shape) wrapping `Domains` with staleness logic:
  - constructor: `{ domains: Domains, ttlMs?: number }` (default `ttlMs = 24 * 60 * 60 * 1000`).
  - `get({ domain, dkimSelectors }): Promise<DomainDns>` — reads the domain record; if `dns` missing or `Date.now() - Date.parse(dns.fetchedAt) > ttlMs`, refetches via `resolveDomainDns`, writes back with `Domains.putDns`, returns fresh; otherwise returns cached.
  - `refresh({ domain, dkimSelectors }): Promise<DomainDns>` — force refetch + write (ignores TTL). Backs the frontend purge.
  - `purge({ domain }): Promise<void>` — `Domains.clearDns`.

`@beesolve/dmarc-dashboard` `src/lib/server/advisory.ts`:

- `buildAdvisory(...)` as above.

### Cross-Package Dependencies

- No new external dependencies. `node:dns/promises` is built into Node 24. The dashboard already depends on `@beesolve/dmarc-consumer` (`workspace:^`).
- New package export `./dns` must be added to `packages/dmarc-consumer/package.json` `exports` (mirror the existing `./domain`, `./ip-info` entries) and to the barrel/build (`build.ts`/bunup entry list — check how `ipInfo.ts` is exposed and follow the same wiring).
- The dashboard `hooks.server.ts` wires a new `dnsCache` into `event.locals.services` (single-instantiation pattern — never instantiate in route files). TTL sourced from an optional env var `DNS_CACHE_TTL_MS` (added to `envSchema`, `v.optional`).

### CDK Constructs

None. No new tables — the DNS cache lives on the existing domain item in the existing DMARC table. Lambda egress for outbound DNS works by default (these functions are not VPC-attached; the ipinfo HTTP lookups already make outbound calls). No IAM changes needed for DNS.

### Key Design Decisions

- **DNS cache lives on the domain record as an optional field**, per the user's explicit instruction — not a separate cache item. Backward compatible because `dns` is `v.optional`. Written with a targeted `SET #dns` update so it never interferes with the `ADD` counter updates in `upsert`.
- **Staleness computed on read** against a configurable TTL (default 24h) using the stored `fetchedAt`, mirroring the `fetchedAt` convention already in `ipInfo.ts`. Stale reads trigger a transparent refetch-and-writeback.
- **Frontend purge** = force-refresh action (`refresh`) rather than a destructive delete, so the user immediately gets fresh data after a DNS change. A hard `purge` (REMOVE) is also exposed for completeness.
- **DKIM selectors are observation-driven.** DNS can't enumerate arbitrary selectors, so we query exactly the selectors seen in `authResults.dkim[].selector` (already parsed in `dmarc-parser`). The dashboard passes observed selectors from the aggregate into `dnsCache.get`.
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

- [ ] In `packages/dmarc-consumer/domain.ts`, add the schemas: `spfAllQualifiers`/`SpfAllQualifier`, `spfMechanismSchema`, `dmarcPolicies`, `alignmentModes`, `dmarcRecordDnsSchema`, `dkimSelectorSchema`, `domainDnsSchema`/`DomainDns` (all as specified in Architecture → Types and Schemas). Use `v.picklist` with `as const` arrays for literal unions.
- [ ] Extend the existing `schema` with `dns: v.optional(domainDnsSchema)`. Confirm existing stored records (without `dns`) still parse (optional field).
- [ ] Add pure parsers in the same file (or a colocated `dnsParse.ts` — pick one and be consistent):
  - `parseSpfRecord(txt: string): SpfMechanism` — detect `v=spf1`, extract the trailing `all` qualifier (`-all`/`~all`/`?all`/`+all`), count DNS-lookup mechanisms (`include:`, `a`, `mx`, `ptr`, `exists:`, `redirect=`) for the 10-lookup guidance, set `valid`.
  - `parseDmarcRecord(txt: string): DmarcRecordDns` — detect `v=DMARC1`, parse `p`, `sp`, `pct` (number), `adkim`, `aspf`, `rua` (split addresses), set `valid`.
- [ ] Export all new types, schemas, and parsers.
- [ ] Include tests: `packages/dmarc-consumer/tests/dnsParse.test.ts` — assert parsing of representative SPF records (`-all`, `~all`, over-10-lookups), a `p=reject; pct=100; adkim=s` DMARC record, a `p=none` record, and malformed/non-matching strings (`valid:false`).

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

### Task 3: DNS resolver + cache (`dns.ts`) with TTL staleness and purge

- [ ] Create `packages/dmarc-consumer/dns.ts`.
- [ ] `resolveDomainDns({ domain, dkimSelectors }: { domain: string; dkimSelectors: Array<string> }): Promise<DomainDns>`:
  - Use `import { resolveTxt } from "node:dns/promises"`.
  - Resolve `_dmarc.<domain>` → join TXT chunks → `parseDmarcRecord`.
  - Resolve `<domain>` → find the `v=spf1` record → `parseSpfRecord`.
  - For each selector in `dkimSelectors`, resolve `<selector>._domainkey.<domain>` → `{ selector, found: true, raw }`, or `{ selector, found: false }` on `ENODATA`/`ENOTFOUND`.
  - Set `fetchedAt: new Date().toISOString()`. Catch per-lookup errors so one failing lookup doesn't abort the others; record a top-level `error` string only when the whole resolution is unusable.
- [ ] `DnsCache` class: constructor `{ domains: Domains; ttlMs?: number }` (default `24 * 60 * 60 * 1000`). Methods:
  - `get({ domain, dkimSelectors })` — read via `domains.getByDomain`; if `dns` absent or stale (`Date.now() - Date.parse(dns.fetchedAt) > ttlMs`), call `resolveDomainDns`, `domains.putDns`, return fresh; else return cached `dns`.
  - `refresh({ domain, dkimSelectors })` — always resolve + `putDns`, return fresh.
  - `purge({ domain })` — `domains.clearDns`.
- [ ] Add `./dns` to `packages/dmarc-consumer/package.json` `exports` (mirror `./ip-info`) and wire into the build (`build.ts`/bunup entries — follow how `ipInfo.ts` is built).
- [ ] Include tests: `packages/dmarc-consumer/tests/dns.test.ts` — mock a `Domains` with in-memory `getByDomain`/`putDns`; assert: fresh cache returns without calling resolver; stale (old `fetchedAt`) triggers writeback; `refresh` always writes; `purge` calls `clearDns`. Keep `resolveDomainDns` network calls out of the cache tests (inject or stub the resolver).

**Files:** `packages/dmarc-consumer/dns.ts`, `packages/dmarc-consumer/package.json`, `packages/dmarc-consumer/build.ts`, `packages/dmarc-consumer/tests/dns.test.ts`

**Acceptance criteria:** DNS cache tests pass; `./dns` export resolves in a type-check; check gates clean.

---

### Task 4: ADR for DNS-on-domain-record decision

- [ ] Create `packages/dmarc-consumer/docs/adr-002-dns-cache-on-domain-record.md` following the repo ADR format (Status/Context/Decision/Rationale/Consequences/Alternatives Considered).
- [ ] Capture: why DNS is cached on the domain record (single-table, backward-compatible optional field) vs a separate cache item; TTL-on-read staleness with `fetchedAt`; frontend force-refresh/purge; observation-driven DKIM selectors.

**Files:** `packages/dmarc-consumer/docs/adr-002-dns-cache-on-domain-record.md`

**Acceptance criteria:** ADR exists, numbered, follows the format. (No code — no check-gate impact.)

---

### Task 5: Setup advisory builder (dashboard, pure function + tests)

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

### Task 6: Wire `dnsCache` into dashboard hooks + domain detail load

- [ ] In `packages/dmarc-dashboard/src/hooks.server.ts`: import `DnsCache` from `@beesolve/dmarc-consumer/dns`; add `DNS_CACHE_TTL_MS: v.optional(v.string())` to `envSchema`; instantiate `const dnsCache = new DnsCache({ domains, ttlMs: env.DNS_CACHE_TTL_MS != null ? Number(env.DNS_CACHE_TTL_MS) : undefined });` and add `dnsCache` to `event.locals.services`. Update the `App.Locals` services type (`src/app.d.ts` or wherever `services` is typed).
- [ ] In `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts` `load`: after computing `aggregate`, derive observed DKIM selectors from the parsed records (collect `authResults.dkim[].selector`; if not already surfaced by the aggregate, extend the aggregate minimally to expose them, or re-derive here from `result.reports`). Call `const dns = await locals.services.dnsCache.get({ domain: params.domain, dkimSelectors })`. Call `const advisory = buildAdvisory({ dns, aggregate })`. Add `dns` and `advisory` to the returned data.
- [ ] Add a `?/purgeDns` — use the DEFAULT form action to avoid the named-action `?/` CloudFront issue, OR a dedicated route action encoding the `/`. Prefer default action pattern (see the overview page which already uses a default action). The action calls `locals.services.dnsCache.refresh({ domain, dkimSelectors })` (force refetch) and returns success; enforce the same access check as `load` (`user.type !== "admin" && !user.domains.includes(domain)` → 403).

**Files:** `packages/dmarc-dashboard/src/hooks.server.ts`, `packages/dmarc-dashboard/src/app.d.ts`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`

**Acceptance criteria:** Dashboard type-check passes; `load` returns `dns` + `advisory`; the refresh action force-refetches and writes back. Check gates clean.

---

### Task 7: Domain detail UI — advisory panel, relocated Refresh IP details, DNS purge

- [ ] In `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`:
  - Add a "Setup health" section/card near the top that renders `data.advisory` findings, color-coded by severity (`ok`→success, `info`→neutral, `warning`→warning, `critical`→error), each showing `title` + `detail`. Use existing token conventions (`--success`/`--warning`/`--error`, graffiti `.tag`/`.callout`).
  - Show the resolved DNS summary (policy `p`, `pct`, SPF `all` qualifier, DKIM selectors found) compactly, with a "Refresh DNS" button that submits the default form action (`?/purgeDns` → force refetch). Reflect last-fetched time from `data.dns.fetchedAt`.
  - Relocate the **"Refresh IP details"** control here (from the overview): a small ghost button near the Source IPs tab header, submitting the domain's backfill. Move the associated last-run status display and the explanatory hint text here too. Keep the `use:enhance` + submitting-state pattern from the current overview implementation.
- [ ] Ensure the Refresh IP details action is available on this page — either reuse a default form action wired to `locals.services.backfill.start` in this route's `+page.server.ts`, mirroring the overview action (access check + 409 on already-running). (Coordinate with Task 6’s server file; both DNS-refresh and IP-refresh actions live here — if two default actions collide, use distinct named actions with `/` encoded per the sveltekit-lambda steering, or a hidden `intent` field on a single default action.)

**Files:** `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`

**Acceptance criteria:** Advisory panel renders findings; DNS refresh + IP-details refresh both work from the detail page; dashboard type-check + check gates clean.

---

### Task 8: Overview UI reframe — remove Refresh IP details, fix pass-rate framing

- [ ] In `packages/dmarc-dashboard/src/routes/+page.svelte`:
  - Remove the "Sender origins" column, the refresh `<form>`/button, the `last-run` display, the `.hint` paragraph, and the now-unused `enhance`/`submittingDomain` state.
  - Rename the "Pass Rate" summary card and the table column to a non-alarming label (e.g. "Delivered / not actioned"), OR replace with two clearer signals if aggregate data allows at overview level. At minimum: stop using `StatusBadge`'s red/amber thresholds on the disposition rate. If keeping a per-row indicator, use a neutral presentation for the disposition rate.
  - Keep the domain link, Messages, Pass, Fail columns.
- [ ] In `packages/dmarc-dashboard/src/routes/+page.server.ts`: remove the `default` backfill action and the `backfill.getStatuses()`/`canRun`/`lastRun` wiring from `load` (that concern now lives on the domain detail page). Keep the access-filtered domain list.
- [ ] Review `packages/dmarc-dashboard/src/lib/components/statusBadge.svelte` usage: it should only be applied to genuinely "high-is-good" metrics (SPF/DKIM auth health), not the disposition rate. Adjust where it's used accordingly (the per-report "Pass Rate" column on the detail page uses the same inverted metric — relabel/neutralize there too, or repoint the badge at an auth-health rate).

**Files:** `packages/dmarc-dashboard/src/routes/+page.svelte`, `packages/dmarc-dashboard/src/routes/+page.server.ts`, `packages/dmarc-dashboard/src/lib/components/statusBadge.svelte` (usage), `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte` (per-report Pass Rate relabel)

**Acceptance criteria:** Overview no longer shows Refresh IP details; disposition "pass rate" is no longer alarm-colored; domain list still renders and links work; dashboard type-check + check gates clean.

---

### Task 9: Changesets + end-to-end verification

- [ ] Read `packages/dmarc-consumer/package.json` and the dashboard `package.json` `name` fields. Create changesets: a **minor** bump for `@beesolve/dmarc-consumer` (new `./dns` export, new domain accessors, optional schema field) and an appropriate bump for the dashboard package. Do not assume package names match directory names.
- [ ] Run full `bun run check`, `bun run type-check`, `bun test`, plus the dashboard's own type-check/svelte-check.
- [ ] Manually reason through the SvelteKit-on-Lambda constraints from steering: default form actions (avoid `?/named` behind CloudFront), single service instantiation in hooks, and `@beesolve/lambda-fetch-api` SSR external (only relevant if touched).

**Files:** `.changeset/*.md`

**Acceptance criteria:** All check gates pass across the workspace; changesets present with correct package names and bump levels.

---

## Future Work (out of scope)

- Live DKIM key **validity** parsing (key type/length, `t=y` test flag) beyond presence detection.
- SPF include-chain flattening / actual recursive lookup resolution (current lookup count is a static parse of the record's own mechanisms).
- A dedicated "Setup" onboarding wizard that walks a user from `p=none` → `quarantine` → `reject`.
- Background/scheduled DNS refresh (currently refetch is lazy-on-read + manual force-refresh).
- Surfacing advisory findings on the overview page (currently only on domain detail).
