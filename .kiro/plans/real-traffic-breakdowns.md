# Three-Tier Totals and Breakdowns (All / Real / Watch)

## Status: Draft (pending review)

## Problem Statement

The site-wide totals and `status`/`country`/`device` breakdowns count every
CloudFront log row for the hour (the hourly Athena query filters only on the
time partition). Much of that is not genuine page views: bot probes, scanners,
asset/image requests, and error responses. Operators want the same
totals/breakdowns narrowed to genuine page views, without losing the raw
all-traffic view.

Two narrowings answer different questions and both should ship as tiers:

- **real** - content-type + status filter
  (`sc_content_type LIKE 'text/html%' AND sc_status BETWEEN 200 AND 299`):
  browser-served HTML page views. O(1) in query size, independent of any curated
  list. `2xx` only (not `2xx/3xx`): a `301`/`302` is a redirect, not a page view,
  and the old 404 rewrite logged large volumes of `text/html` `3xx`. The content
  type is matched with `LIKE 'text/html%'` to catch the
  `text/html;charset=utf-8` variant.
- **watch** - active `source="sitemap"` watch entries: traffic to the curated
  page set. Reuses the sitemap `IN`-list machinery (ADR-009).

The existing all-traffic view is kept unchanged as the **all** tier. Each tier
is one combined bucket (not per-URL) of totals + status/country/device
breakdowns, stored in its own namespace with its own applied markers, surfaced
via a dashboard tier selector.

See `packages/analytics-processor/docs/adr-010-real-traffic-breakdowns.md`.

## Prerequisites (for the `real` tier) - forward-only, no history

`sc-content-type` is not delivered in v2 logs yet. The `real` tier populates
**from the redeploy forward**:

1. Add `sc_content_type` to `requiredRecordFields`, `columnMap`, and the Glue
   column map; redeploy so delivered logs carry it.
2. The CloudFront `404 -> /index.html (200)` rewrite removal is treated as done
   by the operator.

Historical data is treated as wrong and is **not** backfilled or re-compacted.
The `watch` tier likewise accumulates forward from the redeploy. The
`compactColumnMap` is corrected for code correctness but not re-run for
`barlog.sk`.

The `real` predicate is `2xx` only (not `2xx/3xx`): a `301`/`302` is a redirect,
not a page view, and the old 404 rewrite logged large volumes of `text/html`
`3xx`. The content type is matched with `LIKE 'text/html%'` to catch the
`text/html;charset=utf-8` variant.

## Architecture / Approach

### Namespaces and markers (per tier)

Mirror the existing shapes; only the key prefix differs. For the `all` tier the
tier segment is empty, so its keys are unchanged.

- Totals: `pk = "totals#<tier>#<grain>"`, `sk = <timeKey>`.
- Breakdowns: `pk = "breakdown#<tier>#<dimension>#<grain>#<periodKey>"`,
  `sk = <value>`.
- Markers: `pk = "applied#<tier>-<grain>#<periodKey>"`, `sk = "applied"`.

TTL (ADR-009): hourly tiers + markers carry the 90-day `hourlyTtlDays` TTL;
day/month aggregates have no TTL.

### Predicates

- **real**: time-partition predicate AND
  `sc_content_type LIKE 'text/html%' AND CAST(sc_status AS integer) BETWEEN 200 AND 299`.
  O(1); always runs once `sc_content_type` is available.
- **watch**: time-partition predicate AND
  `canonical(cs_uri_stem) IN ('/', '/blog', ...)` over active `source="sitemap"`
  entries. Empty set -> no-op (write nothing, no query), never a full scan.

### Processing model

Reuse the live-`ADD` + backfill pattern. After the existing all-traffic write,
for each enabled tier run one cloned `buildHourlyQuery` with the tier predicate,
reshape identically (`assembleResult` -> `byStatus`/`byDevice`/`topIps`), resolve
country from `topIps` via the existing IPinfo enrichment, and write the tier's
totals + breakdowns with `ADD` under that tier's hourly marker. Daily/monthly
rollups sum the finer stored tiers under the tier's day/month markers.

### Backfill

The backfill CLI already drives `processHour` under the marker guard. Add:

- `--tier <all|real|watch>` (repeatable) to scope the backfill to a tier's
  namespace.
- `--force` to ignore the applied marker and overwrite the selected tier for the
  range (the one-off reprocess lever; lives only on the CLI, affects only the
  stack and tier selected).

### Read side

Thread a `tier: "all" | "real" | "watch"` selector through the dashboard remote
queries into `resolveTotalsLive`/`resolveBreakdownLive`, which take a
namespace/prefix parameter (default `all`). The Totals and Breakdowns pages get a
tier selector.

## Tasks

### 1. Add `sc_content_type` to the v2 ingested schema

- Add `sc_content_type` to `requiredRecordFields` and `columnMap` in
  `src/athena.ts`.
- Add it to the Glue column map so the live v2 table exposes it.
- Update the CDK logging record-fields config so CloudFront delivers it.
- Tests: `columnMap` exposes the content-type reference.

### 1b. Correct the compaction column map (code only, not re-run)

- Add `{ v1: '"sc-content-type"', v2: "sc_content_type" }` to `compactColumnMap`
  in `command/compact.ts` so future compactions carry content type.
- Do **not** re-compact `barlog.sk` history; this task is correctness only.
- Test: `compactColumnMap` includes the content-type projection and the select
  emits it.

### 2. Key schema + marker grain for tier namespaces

- Add a `tier` parameter (`"all" | "real" | "watch"`) to `Totals`,
  `Breakdowns`, and `AppliedMarkers` key builders so they address
  `totals#<tier>#…`, `breakdown#<tier>#…`, `applied#<tier>-<grain>#…`, with the
  `all` tier producing today's unchanged keys.
- Extend `MarkerGrain` / key builders to carry the tier prefix.
- Unit tests for the new key strings (including that `all` is byte-identical to
  the current keys).

### 3. Tier predicate builders

- `real`: a constant predicate fragment
  (`sc_content_type LIKE 'text/html%' AND … BETWEEN 200 AND 299`).
- `watch`: a helper over active `source="sitemap"` entries building
  `canonical(cs_uri_stem) IN (...)` via `canonicalUriExpr` + `escapeSqlString`,
  with an empty-set sentinel the caller treats as no-op.
- Unit tests: real fragment shape; watch empty/single/many/quote-escape/slash-fold.

### 4. Parameterize the hourly query with a tier predicate

- Let `buildHourlyQuery` accept an optional extra WHERE predicate appended to the
  partition filter; reuse `assembleResult` unchanged.
- Unit tests asserting the predicate is injected and GROUPING SETS unchanged.

### 5. Wire tier aggregation into `processHour`

- After the all-traffic write, for each enabled tier build the predicate and (if
  non-empty for watch) run the tier query and write `<tier>#` totals +
  breakdowns with `ADD` under the tier marker.
- `watch` no-ops cleanly on empty sitemap set.
- Tests with mocked Athena + in-memory dynamo asserting per-tier items/markers;
  empty watch set writes nothing.

### 6. Tier daily/monthly rollups

- Add per-tier rollup passes summing the finer tier tiers under the tier's
  day/month markers, mirroring `applyDailyRollup`/`applyMonthlyRollup`.
- Tests mirroring the existing rollup tests against the tier keys.

### 7. Backfill: `--tier` and `--force` (general tooling, not run here)

- Add `--tier` (repeatable, default all three) and `--force` to
  `command/backfill.ts` and `parseBackfillArgs`.
- `--force` passes through to `processHour` to bypass the marker check and
  overwrite.
- These ship as general operator levers; **not run for `barlog.sk`** (history
  out of scope). Document in the operational-commands how-to.
- Tests for arg parsing and that `--force` reprocesses a marked hour.

### 8. Read side: `tier` selector

- Add `tier` to `resolveTotalsLive`/`resolveBreakdownLive` and the
  `getTotals`/`getBreakdown` remote queries.
- Tests: each tier reads its namespace; `all` unchanged.

### 9. Dashboard tier selector

- Add a tier selector (all / real / watch) on the Totals and Breakdowns pages
  using a graffiti control; no new global CSS.
- Copy explaining each tier (real = HTML page views; watch = sitemap pages).

### 10. CloudFront 404 fix (operator, treated as done)

- The `404 -> /index.html (200)` custom error response is being removed by the
  operator so unknown paths return real `404`s. This is in the consuming site
  stack, not this package. The `2xx`-only `real` predicate does not depend on it
  for correctness (it excludes `3xx` by status), but the fix stops future probe
  redirects from being logged as `text/html` `301` at all.

### 11. ADR + docs + changeset

- ADR-010 (done).
- Update `DOCS.md` and the relevant how-to with the three tiers and backfill.
- Changeset (`@beesolve/analytics-processor` minor; `@beesolve/analytics-dashboard`
  minor). Note the `requiredRecordFields` change is breaking for log delivery
  config; at `0.x` it is a minor bump per the versioning convention.

## Scalability note

The `watch` tier's sitemap `IN` list grows with the catalog: hundreds trivial,
~1,000 fine, ~10,000 exceeds Athena's ~262 KB statement limit. The `real` tier
is O(1) and unaffected, so a site that outgrows the sitemap list simply relies on
the `real` tier for page-view metrics.

## Cost (measured)

Against live `barlog.sk` logs: column-pruned scan ~0.015 MB/hour; Athena bills a
10 MB-per-query floor. Two added tiers ongoing: ~$0.07/month. No history backfill
is run, so no one-time cost. Athena cost is not a constraint.

## Out of Scope

- Per-URL real/watch breakdowns (watch model already covers per-URL).
- Manual watch entries as a tier (watch is sitemap-only by decision).
