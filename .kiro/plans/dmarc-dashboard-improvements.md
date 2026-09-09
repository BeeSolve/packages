# DMARC Dashboard Improvements — Unbuilt Features

## Status: Not Started

## Problem Statement

The DMARC dashboard (`packages/dmarc-dashboard`, `@beesolve/dmarc-dashboard`) already
delivers domain overview, per-domain drill-down with source-IP analysis, IP enrichment
(ASN/org/country via ipinfo.io Lite), a DNS setup-health advisory, processing stats, and
multi-user access. A competitive-research backlog (`packages/dmarc-dashboard/improvement-plan.md`)
enumerated ten features seen in paid DMARC platforms. Several have since shipped
(sender identification, most of policy-progression guidance, current-state DNS refresh),
but the highest-value analytical and monitoring features remain unbuilt.

This plan converts the still-unbuilt items from that backlog into concrete, ordered
implementation tasks. It targets the features that are self-contained, high-value, and
buildable on existing data:

- **Trend/timeline charts** — daily volume + pass-rate over time per domain (data
  groundwork already exists via `Reports.getDailyAggregate`, but no endpoint, chart, or
  charting primitive is wired).
- **Subdomain discovery** — surface subdomains observed in report `headerFrom` data
  (the raw data is already collected in `aggregate.ts` but never extracted or displayed).
- **Executive/compliance portfolio view** — enforcement status per domain, portfolio
  posture, and aggregate spoofing-blocked rollup on the home overview (currently only raw
  totals; DMARC `p=` is not surfaced until you drill into a domain).
- **Policy readiness score** — the partial gap in the already-shipped advisory: a numeric,
  explainable "safe to tighten policy?" score complementing the existing flat findings list.
- **DNS change monitoring** — the partial gap in the already-shipped DNS refresh: retain
  DNS history and detect/surface changes (SPF/DKIM/DMARC record drift), rather than only
  overwriting the current cached state.
- **Anomaly alerts (daily digest)** — a scheduled job that compares each domain's recent
  activity to a baseline (new sending IPs, volume spikes, pass-rate drops, DNS changes)
  and emails a digest to users with access.

Explicitly deferred (see Future Work): GeoIP **map** visualization (country data is
already stored and shown as text — a map is cosmetic and needs a geo library), RUF/forensic
report ingestion (high effort, poor receiver support, PII/encryption concerns), and
lookalike/cousin-domain detection (requires external domain-monitoring infrastructure).

## Architecture / Approach

### Existing data model (unchanged — consumed, not modified, except where noted)

Single DynamoDB table (`dmarc-consumer`) + reverse GSI (`sk`→`pk`), TTL attribute `ttl`:

| Entity           | pk                    | sk                                    | Notes                                                                     |
| ---------------- | --------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| Domain aggregate | `domain#<domain>`     | `domain`                              | `totalMessages/Pass/Fail`, optional `dns` (`DomainDns`), `selectors` (SS) |
| Report           | `domain#<domain>`     | `report#<tsSeconds>#<org>#<reportId>` | full parsed report incl. `records[]`                                      |
| Processing stats | `stats#daily`         | `<YYYY-MM-DD>`                        | ingestion counters                                                        |
| IP info cache    | `ipinfo#<ip>`         | `ipinfo`                              | `asn/asName/country/...`                                                  |
| Job config       | `system#config`       | `ipBackfill` \| `dnsRefresh`          | per-domain run state (`JobRuns`)                                          |
| Job run history  | `dnsRefresh#<domain>` | `run#<runId>`                         | run history per job kind                                                  |

New entities introduced by this plan (all additive, backward compatible):

| Entity              | pk                | sk                   | Introduced by | Notes                                                       |
| ------------------- | ----------------- | -------------------- | ------------- | ----------------------------------------------------------- |
| Domain daily rollup | `domain#<domain>` | `daily#<YYYY-MM-DD>` | Task 1        | precomputed per-day volume/pass/fail for fast trend queries |
| DNS snapshot        | `domain#<domain>` | `dnsSnapshot#<ISO>`  | Task 6        | historical DNS records for change detection (TTL-capped)    |

### Key design decisions

- **Precompute daily rollups at ingest, do not scan reports at read time.** The domain
  detail loader currently aggregates only the last 50 reports; a 30/90-day trend cannot be
  built from that without unbounded reads. Instead, `dmarc-consumer` writes a per-day
  rollup item (`daily#<date>`) via atomic `ADD` counters when it upserts the domain
  aggregate (mirrors the existing `stats#daily` pattern). Trend queries become a single
  bounded `begins_with(sk, "daily#")` range query. `Reports.getDailyAggregate` (which
  scans a day's reports) stays available for the alert job but is not on the dashboard hot
  path.
- **Charting stays dependency-light.** Follow the existing convention (`stats/+page.svelte`
  already hand-rolls a CSS stacked-bar). Build a small reusable inline-SVG line/area chart
  as a Svelte component using graffiti tokens — no `chart.js`/`d3` dependency. This matches
  the `sveltekit-lambda` "graffiti-first, hand-roll only genuine gaps (bar chart)" steering.
- **Readiness score is a pure function** layered on the existing `buildAdvisory` inputs
  (`dns` + `DomainAggregate`), not a new data source. It returns a 0–100 score, a
  band (`not-ready`/`almost`/`ready`), and the contributing reasons, so the UI can explain
  it. It composes the existing findings rather than replacing them.
- **DNS change monitoring keeps history as separate snapshot items**, not by mutating the
  single `dns` field. `Domains.putDns` continues to write the current `dns`; a new
  `putDnsSnapshot` appends an immutable `dnsSnapshot#<ISO>` item (with `ttl` for retention).
  Change detection diffs the newest two snapshots. This avoids a read-modify-write race on
  the domain item and gives an audit trail.
- **Alerts reuse existing infrastructure.** A daily EventBridge cron (sibling to the
  existing `dnsCron`) fans out per-domain analysis, compares recent vs baseline using the
  daily rollups + DNS snapshots, and sends a digest via the `@beesolve/email-service`
  `Email` SDK the dashboard already instantiates. No new queue; no new table.
- **Subdomain discovery is read-derived**, no new storage. `headerFrom` values are already
  captured per source IP in `aggregate.ts` (`SourceIpBreakdown.headerFroms`). Extraction is
  a pure helper that groups them under the registered domain and reports each subdomain's
  auth posture. Rendered as a tab/section on the domain detail page.
- **Executive view aggregates existing per-domain data** plus each domain's `dns.dmarc.policy`
  (already resolved and stored). The home loader gains the `dns` field per domain (via
  `Domains.list()` already returning the full item) to show enforcement status without an
  extra round-trip.

### Public API surface changes

`@beesolve/dmarc-consumer`:

- `domain.ts` `Domains`:
  - `upsertDaily({ domain, date, totalMessages, totalPass, totalFail }): Promise<void>` —
    `ADD` counters on `daily#<date>` (Task 1).
  - `listDaily({ domain, from, to }): Promise<Array<DomainDaily>>` — `begins_with`/BETWEEN
    range query for the trend (Task 1).
  - `putDnsSnapshot({ domain, dns }): Promise<void>` — append `dnsSnapshot#<ISO>` with `ttl`
    (Task 6).
  - `listDnsSnapshots({ domain, limit }): Promise<Array<DnsSnapshot>>` — newest-first
    (Task 6).
- New `domainDailySchema` / `DomainDaily`, `dnsSnapshotSchema` / `DnsSnapshot` types +
  `./domain-daily` export wiring (or extend the existing `domain` module — follow current
  export layout).
- New `detectDnsChanges({ previous, current }): Array<DnsChange>` pure helper (Task 6) in a
  `dnsDiff.ts` module.

`@beesolve/dmarc-dashboard`:

- `src/lib/server/trend.ts` — `buildTrend({ daily }): TrendSeries` (Task 1 consumer side).
- `src/lib/components/lineChart.svelte` — reusable inline-SVG chart (Task 2).
- `src/lib/server/readiness.ts` — `computeReadiness({ dns, aggregate }): ReadinessScore`
  (Task 3).
- `src/lib/server/subdomains.ts` — `extractSubdomains({ aggregate, domain }): Array<SubdomainSummary>`
  (Task 4).
- New route `src/routes/domains/[domain]/trends/+page.*` or a Trends tab on the domain
  detail page (Task 2 — decide at execution: a tab is preferred, matching existing
  `<details name="domain-tab">` tabs).

### CDK constructs

- `packages/dmarc-consumer/cdk.ts`: add a second daily EventBridge `Rule` targeting a new
  `Nodejs24Function` (`alertCron`) with table read + `Email` SDK grant + the dashboard's
  sender identity. Mirror the existing `DnsCronSchedule` wiring. No new table, no new queue.
- The consumer already writes the domain aggregate at ingest; Task 1 adds the daily-rollup
  `ADD` in the same code path (no new Lambda for rollups).

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (per changed package; for the dashboard run its `svelte-check` too)
3. `bun test`

**Rules for subagents:**

- Each task must be self-contained.
- No commits — leave changes uncommitted for review.
- Follow `.kiro/steering/`: no narrating comments, `== null`/`!= null` nullish checks,
  `import type` for type-only imports, `v.picklist` (with `as const`) for string-literal
  unions, descriptive full names in array callbacks, named object params for 3+ args,
  early returns, no classes except where wrapping external APIs.
- DynamoDB: pass `marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false }`;
  composite-key `attribute_not_exists` must check BOTH `pk` AND `sk`.
- Use `workspace:^` for intra-monorepo deps; `catalog:` for shared external deps.
  Run `bun install` after adding deps and `bun run recalculate-dependencies` after changing
  intra-monorepo deps.
- `dmarc-consumer` public API is per-module `exports` in `package.json` built by bunup —
  new modules need an `exports` entry + build wiring (follow how `dns`/`ip-info` are wired).
  Build the consumer (`bunx bunup --filter @beesolve/dmarc-consumer`) before the dashboard
  type-checks against new exports.
- SvelteKit (`sveltekit-lambda` steering): Prettier formats `.svelte`; services are
  instantiated ONCE in `hooks.server.ts` and read via `event.locals.services.*` — never
  instantiate clients in route files; use graffiti components first, hand-roll only genuine
  gaps (the line chart is a genuine gap); use the single default form action + hidden
  `intent` field, no `?/named` actions.
- Package names differ from directory names — read `package.json` `name` before writing
  changesets (`packages/dmarc-consumer` → `@beesolve/dmarc-consumer`; `packages/dmarc-dashboard`
  → `@beesolve/dmarc-dashboard`).
- Create/extend ADRs in `packages/<name>/docs/` for the daily-rollup and DNS-snapshot
  storage decisions.
- If check gates fail on unrelated pre-existing issues, note them but do not fix.

## Tasks

### Task 1: Daily domain rollup entity + write at ingest (dmarc-consumer)

- [ ] In `packages/dmarc-consumer/domain.ts` (or a new `domainDaily.ts` following the
      export layout), add `domainDailySchema`/`DomainDaily`: `pk: v.string()` (`domain#<domain>`),
      `sk: v.string()` (`daily#<YYYY-MM-DD>`), `date: v.string()`, `totalMessages`,
      `totalPass`, `totalFail` (numbers).
- [ ] Add `Domains.upsertDaily({ domain, date, totalMessages, totalPass, totalFail })` —
      `UpdateCommand` `SET #date = :date` + `ADD totalMessages :m, totalPass :p, totalFail :f`
      on key `{ pk: domain#<domain>, sk: daily#<date> }` (atomic counters, no read-before-write).
      `date` is UTC `YYYY-MM-DD`.
- [ ] Add `Domains.listDaily({ domain, from, to })` — `QueryCommand` on `pk = domain#<domain>`
      with `sk BETWEEN daily#<from> AND daily#<to>` (or `begins_with(sk, "daily#")` when no
      range), parsed via the existing `parseOne` pattern, returned oldest-first.
- [ ] Wire the daily `ADD` into the existing ingest path where the domain aggregate is
      upserted (`src/reportBatch.ts` / `upsertDomainAggregates`): derive the UTC date from
      each report's date range and call `upsertDaily` alongside the existing `upsert`. Keep
      counter math identical to the all-time aggregate (per-domain per-batch sums).
- [ ] Add `./domain-daily` (or extend `./domain`) to `package.json` `exports` + bunup build
      wiring if a new module.
- [ ] Include tests: extend `tests/domain.test.ts` (or new `tests/domainDaily.test.ts`) —
      `upsertDaily` sends correct `ADD`/`SET` on the `daily#<date>` key; `listDaily` builds
      the correct range query and parses items; ingest path calls `upsertDaily` with the
      right date/counts (extend `tests/consumer.test.ts` / the pure `processReportBatch`).

**Files:** `packages/dmarc-consumer/domain.ts` (+ optional `domainDaily.ts`),
`packages/dmarc-consumer/src/reportBatch.ts`, `packages/dmarc-consumer/package.json`,
`packages/dmarc-consumer/bunup.config.ts`, `packages/dmarc-consumer/tests/*`

**Acceptance criteria:** `upsertDaily`/`listDaily` unit tests pass; ingest writes a daily
rollup per domain per batch; existing domain-aggregate behavior unchanged; check gates clean.

---

### Task 2: Trend series builder + line chart + domain Trends tab (dmarc-dashboard)

- [ ] Create `src/lib/server/trend.ts` — `buildTrend({ daily }: { daily: Array<DomainDaily> }): TrendSeries`
      returning `{ points: Array<{ date: string; totalMessages: number; passRate: number }> }`
      (passRate = round(totalPass / totalMessages * 100), 0 when no messages). Pure, no I/O.
- [ ] Create `src/lib/components/lineChart.svelte` — a reusable inline-SVG chart: props
      `points` (x=date, series for volume as bars/area + passRate as a line 0–100 on a
      secondary axis), responsive `viewBox`, graffiti tokens (`--fg`, `--primary`,
      `--success`, `--warning`, `--border-1`) — NO new dependency. Accessible: `role="img"` + `aria-label` summary; render a `<caption>`/data-table fallback for screen readers.
- [ ] Add a **Trends** tab to `src/routes/domains/[domain]/+page.svelte` using the existing
      `<details name="domain-tab">` CSS-tab pattern (do not add a separate route unless a tab
      cannot host it). Show a 30-day (default) / 90-day toggle.
- [ ] In `src/routes/domains/[domain]/+page.server.ts` `load`: call
      `locals.services.domains.listDaily({ domain, from, to })` (default last 30 days,
      `?range=90` for 90), pass `buildTrend({ daily })` to the page. Keep it read-only;
      respect the existing domain access check.
- [ ] Include tests: `packages/dmarc-dashboard/tests/trend.test.ts` — `buildTrend` passRate
      math, empty/zero-message days, ordering.

**Files:** `packages/dmarc-dashboard/src/lib/server/trend.ts`,
`packages/dmarc-dashboard/src/lib/components/lineChart.svelte`,
`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`,
`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`,
`packages/dmarc-dashboard/tests/trend.test.ts`

**Acceptance criteria:** Domain detail shows a Trends tab with a volume + pass-rate chart
over 30/90 days sourced from daily rollups (bounded single query); `buildTrend` tests pass;
dashboard `type-check` (svelte-check) + check gates clean.

---

### Task 3: Policy readiness score (dmarc-dashboard)

- [ ] Create `src/lib/server/readiness.ts` — `computeReadiness({ dns, aggregate }): ReadinessScore`
      where `ReadinessScore = { score: number /* 0-100 */, band: "not-ready" | "almost" | "ready",
    reasons: Array<{ id: string; impact: number; detail: string }> }`. Pure function
      reusing the same inputs as `buildAdvisory` (`DomainDns | undefined`, `DomainAggregate`).
      Scoring composes: current policy (`p=none` caps score; `quarantine`/`reject` raise it),
      `pct` < 100 penalty, SPF/DKIM pass rates (the existing `spfPassRate`/`dkimPassRate`
      ≥ thresholds add confidence), unresolved advisory criticals/warnings subtract. Define
      the bands and thresholds explicitly in the module. When `dns == null`, return a
      `not-ready` score with a single "DNS not checked yet" reason (mirror advisory's
      graceful path).
- [ ] Surface it in the existing **Setup health** panel of
      `src/routes/domains/[domain]/+page.svelte`: a compact score gauge/badge (graffiti
      tokens; reuse `.tag`/`--tag-color`) with the top contributing reasons listed. Do NOT
      remove the existing findings list — the score complements it.
- [ ] Compute in `+page.server.ts` `load` alongside the existing `buildAdvisory` call and
      return it (no new data fetch — same `dns`/`aggregate`).
- [ ] Include tests: `packages/dmarc-dashboard/tests/readiness.test.ts` — score/band for
      `p=none` low auth, `p=none` strong auth (almost), `p=reject` strong (ready), and the
      `dns == null` path; assert reasons are populated and impacts sum sanely.

**Files:** `packages/dmarc-dashboard/src/lib/server/readiness.ts`,
`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`,
`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`,
`packages/dmarc-dashboard/tests/readiness.test.ts`

**Acceptance criteria:** Domain detail shows an explainable readiness score/band next to
the findings; `computeReadiness` is pure and unit-tested across policy/auth combinations;
check gates clean.

---

### Task 4: Subdomain discovery (dmarc-dashboard)

- [ ] Create `src/lib/server/subdomains.ts` — `extractSubdomains({ aggregate, domain }): Array<SubdomainSummary>`
      where `SubdomainSummary = { subdomain: string; messages: number; passRate: number;
    isApex: boolean }`. Derive from the `headerFroms` already collected per IP in
      `DomainAggregate.sourceIpBreakdown` (attribute this to volume via each breakdown row's
      `count`). Group distinct `headerFrom` hosts under the registered `domain`; mark the
      apex vs subdomains; skip header-froms that are not within the domain (report but flag
      cross-domain as a separate bucket or omit — decide and document in the module). Pure,
      no I/O.
- [ ] Surface on `src/routes/domains/[domain]/+page.svelte` as a section/tab ("Sending
      hosts" / "Subdomains") listing each subdomain with volume + pass rate, sorted by
      volume. Use a graffiti Table wrapper (`<div class="table"><table>…`). If
      `dns.dmarc.subdomainPolicy` (`sp=`) is present, show it (it is parsed but currently
      unused).
- [ ] Compute in `+page.server.ts` from the already-built `aggregate` (no new fetch).
- [ ] Include tests: `packages/dmarc-dashboard/tests/subdomains.test.ts` — grouping,
      apex-vs-subdomain classification, pass-rate math, cross-domain handling.

**Files:** `packages/dmarc-dashboard/src/lib/server/subdomains.ts`,
`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`,
`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.server.ts`,
`packages/dmarc-dashboard/tests/subdomains.test.ts`

**Acceptance criteria:** Domain detail lists observed subdomains with volume/pass rate and
`sp=` when known; `extractSubdomains` is unit-tested; no new DynamoDB reads; check gates clean.

---

### Task 5: Executive/compliance portfolio view on the home overview (dmarc-dashboard)

- [ ] In `src/routes/+page.server.ts` `load`: `Domains.list()` already returns full domain
      items — surface each domain's `dns?.dmarc?.policy` (enforcement: `none`/`quarantine`/`reject`
      or `unknown` when `dns == null`) and per-domain totals to the page (respect the
      existing admin-vs-whitelist filtering). Compute portfolio rollups: count of domains at
      each enforcement level, total messages, aggregate spoofing-blocked (sum where
      `disposition != none`), and an overall posture summary.
- [ ] In `src/routes/+page.svelte`: add a portfolio summary (graffiti Stat Cards / Card Grid
      `.layout-card`) — domains-at-enforcement breakdown, total protected volume,
      spoofing-blocked total — and add an **Enforcement** column (colored `.tag` by policy)
      to the existing domain table. Keep existing links working.
- [ ] Create `src/lib/server/portfolio.ts` — `buildPortfolio({ domains }): PortfolioSummary`
      pure helper computing the rollups above from the domain list, unit-tested.
- [ ] Include tests: `packages/dmarc-dashboard/tests/portfolio.test.ts` — enforcement-level
      counts, unknown handling when `dns` absent, spoofing-blocked/volume totals.

**Files:** `packages/dmarc-dashboard/src/routes/+page.server.ts`,
`packages/dmarc-dashboard/src/routes/+page.svelte`,
`packages/dmarc-dashboard/src/lib/server/portfolio.ts`,
`packages/dmarc-dashboard/tests/portfolio.test.ts`

**Acceptance criteria:** Home shows portfolio posture + per-domain enforcement status
without drilling in; `buildPortfolio` unit-tested; existing overview behavior preserved;
check gates clean.

---

### Task 6: DNS snapshot history + change detection (dmarc-consumer)

- [ ] In `packages/dmarc-consumer` add `dnsSnapshotSchema`/`DnsSnapshot`: `pk: domain#<domain>`,
      `sk: dnsSnapshot#<ISO>`, `fetchedAt: v.string()`, `dns: domainDnsSchema` (reuse the
      existing `DomainDns` shape), `ttl: v.optional(v.number())`.
- [ ] Add `Domains.putDnsSnapshot({ domain, dns })` — `PutCommand` writing the snapshot item
      with a retention `ttl` (e.g. 180 days; make it a small module constant). Add
      `Domains.listDnsSnapshots({ domain, limit })` — newest-first query
      (`begins_with(sk, "dnsSnapshot#")`, `ScanIndexForward: false`).
- [ ] Create `dnsDiff.ts` — `detectDnsChanges({ previous, current }: { previous?: DomainDns;
    current: DomainDns }): Array<DnsChange>` where `DnsChange = { field: string; before?: string;
    after?: string }`. Compare DMARC `policy`/`pct`/`subdomainPolicy`/`rua`, SPF `raw`/`all`,
      and DKIM selector presence. Pure, no I/O. Empty array when nothing changed or no previous.
- [ ] Wire snapshotting into the DNS refresh worker (`src/runDnsRefresh.ts`): after
      `domains.putDns({ domain, dns })`, also `putDnsSnapshot({ domain, dns })`. (Change
      detection itself is consumed by the alert job in Task 7 and can be surfaced on the
      domain detail page's DNS section listing recent changes — optional here.)
- [ ] Add `./dns-diff` (+ snapshot types) to `package.json` `exports` + bunup wiring.
- [ ] Include tests: `tests/dnsDiff.test.ts` (each change kind + no-change + no-previous),
      extend `tests/domain.test.ts` (`putDnsSnapshot` PutCommand + `ttl`; `listDnsSnapshots`
      query), extend `tests/runDnsRefresh.test.ts` (snapshot written after `putDns`).

**Files:** `packages/dmarc-consumer/domain.ts` (+ snapshot schema),
`packages/dmarc-consumer/dnsDiff.ts`, `packages/dmarc-consumer/src/runDnsRefresh.ts`,
`packages/dmarc-consumer/package.json`, `packages/dmarc-consumer/bunup.config.ts`,
`packages/dmarc-consumer/tests/*`

**Acceptance criteria:** DNS refresh appends an immutable snapshot (TTL-capped) in addition
to updating current `dns`; `detectDnsChanges` unit-tested; `listDnsSnapshots` returns
newest-first; check gates clean.

---

### Task 7: Anomaly alert daily cron + digest email (dmarc-consumer)

- [ ] Create `src/alertCron.ts` — an EventBridge-scheduled handler that, for each domain
      (`domains.list()`): builds a "today vs baseline" comparison using `listDaily`
      (recent day vs trailing average) to flag **volume spikes** and **pass-rate drops**;
      uses `Reports.getDailyAggregate`/`queryByDomain` to detect **new sending IPs** vs a
      prior window; and uses `listDnsSnapshots` + `detectDnsChanges` to flag **DNS changes**.
      Produce a per-domain `Array<Anomaly>` (`{ kind: "new-ip" | "volume-spike" |
    "passrate-drop" | "dns-change"; detail: string; severity }`). Keep the anomaly
      thresholds in a pure, tested `detectAnomalies({ recent, baseline, newIps, dnsChanges })`
      helper; the handler is thin glue.
- [ ] When a domain has anomalies, send a digest via the `Email` SDK
      (`@beesolve/email-service/sdk`) to the users with access to that domain. The dashboard
      already knows users↔domains (`Users` in the dashboard package) — since the cron lives
      in `dmarc-consumer`, either (a) pass recipient resolution via a small injected function
      and read the users table by env-provided table name, or (b) address the digest to a
      configured admin address prop. **Decide at execution and document in the ADR**; prefer
      the simplest that respects domain access. Fire-and-forget per domain (swallow+log a
      failed send; one domain's failure must not abort the sweep).
- [ ] In `packages/dmarc-consumer/cdk.ts`: add a daily `Rule` (`Schedule.rate(Duration.days(1))`,
      offset from the DNS cron) targeting a new `Nodejs24Function` for `alertCron` with table
      read + `Email` SDK grant (`emails.grantAccess`) + sender identity env. No new table/queue.
      Wire the `alertCron` build entry in `build.ts`.
- [ ] Include tests: `tests/detectAnomalies.test.ts` (each anomaly kind + quiet day → none),
      `tests/alertCron.test.ts` (pure sweep glue with injected fakes: domains with/without
      anomalies trigger/skip sends; a send rejection does not abort the sweep), extend
      `tests/cdk.test.ts` (daily alert rule + function synthesize with the email grant).

**Files:** `packages/dmarc-consumer/src/alertCron.ts`,
`packages/dmarc-consumer/src/detectAnomalies.ts`, `packages/dmarc-consumer/cdk.ts`,
`packages/dmarc-consumer/build.ts`, `packages/dmarc-consumer/tests/*`

**Acceptance criteria:** A daily cron detects new IPs / volume spikes / pass-rate drops /
DNS changes and emails a per-domain digest to authorized recipients; anomaly detection is
pure and unit-tested; one failed send does not abort the sweep; CDK synthesizes the rule +
function + email grant; check gates clean.

---

### Task 8: ADRs, changesets, end-to-end verification

- [ ] Create `packages/dmarc-consumer/docs/adr-004-daily-rollups-and-dns-snapshots.md`
      (next free number — verify against `docs/`): capture the daily-rollup-at-ingest
      decision (vs read-time report scans), the DNS-snapshot-history decision (vs mutating
      the single `dns` field), and the alert-cron + digest recipient-resolution decision.
      Follow the repo ADR format.
- [ ] Create changesets — read each `package.json` `name` first (`@beesolve/dmarc-consumer`,
      `@beesolve/dmarc-dashboard`). Both get a **minor** bump (new exports/entities/features,
      pre-1.0). Document the new `dmarc-consumer` exports/entities and the dashboard trend /
      readiness / subdomain / portfolio views.
- [ ] Update `packages/dmarc-dashboard/improvement-plan.md`: mark the now-built items
      (trend charts, subdomain discovery, executive view, readiness score, DNS change
      monitoring, alerts) as done/linked to this plan; leave the deferred items (GeoIP map,
      RUF, lookalike) as the remaining backlog.
- [ ] Run full gates: `bun run check`, per-package `bun run type-check` (incl. dashboard
      `svelte-check`), `bun run build`, `bun test`. Confirm no SCAN was introduced, the
      dashboard does no ipinfo/DNS network calls at render, and trend reads are bounded
      single queries.

**Files:** `packages/dmarc-consumer/docs/adr-004-daily-rollups-and-dns-snapshots.md`,
`.changeset/*.md`, `packages/dmarc-dashboard/improvement-plan.md`

**Acceptance criteria:** ADR + changesets present with correct package names and minor
bumps; the ideas doc reflects what shipped; all gates green repo-wide; CDK synthesizes.

---

## Future Work (out of scope)

- **GeoIP map visualization** — country data is already stored (`ipinfo` `countryCode`/`country`)
  and shown as text; a world/heat map is cosmetic and would need a geo/topojson library and
  a hand-rolled SVG map component. Deferred as low value relative to effort.
- **RUF / forensic (failure) report ingestion** — a separate inbound pipeline, schema, storage,
  and UI; many receivers do not send RUF, and payloads carry PII requiring encryption
  (e.g. OpenPGP). High effort, limited coverage — deferred.
- **Lookalike / cousin-domain detection** — requires external domain-monitoring data sources
  / threat feeds; out of scope for a self-hosted tool.
- **Curated ESP name mapping + reverse-DNS fallback** — sender identification currently relies
  on ipinfo `as_name`; a curated ESP list and rDNS fallback could improve labeling.
- **Readiness-gated auto-progression** — using the readiness score to recommend/automate the
  actual DNS record change (beyond displaying the score).
- **Configurable alert thresholds + per-user notification preferences UI** — the alert cron
  ships with fixed thresholds and access-derived recipients; making thresholds and opt-in/out
  user-configurable is deferred.
- **MTA-STS / TLS-RPT monitoring** — DNS monitoring currently covers SPF/DKIM/DMARC only.
