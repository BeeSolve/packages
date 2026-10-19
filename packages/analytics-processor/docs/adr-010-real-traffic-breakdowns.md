# ADR-010: Three-Tier Totals and Breakdowns (All / Real / Watch)

## Status

Accepted (supersedes the sitemap-only single-tier draft)

## Context

The site-wide totals and `status`/`country`/`device` breakdowns count **every**
CloudFront log row for an hour (the hourly Athena query filters only on the time
partition - see `buildHourlyQuery` in `src/athena.ts`). On a real site a large
share of those rows are not genuine page views: bot probes, scanner traffic,
asset/image requests, and error responses. Operators want to see the same
metrics narrowed to genuine page views, without losing the raw all-traffic view.

Two distinct, operator-meaningful narrowings exist, and they answer different
questions:

1. **"What does browser-served page traffic look like?"** - a content-type +
   status filter (`text/html`, `2xx`/`3xx`). This is O(1) in query size,
   independent of any curated list, and is the honest "a browser was served an
   HTML page" proxy.
2. **"What does traffic to the pages I curated look like?"** - the set of active
   `source="sitemap"` watch entries. This is the site's own declaration of its
   real pages and already has machinery (ADR-009: `syncSitemapWatch`,
   `watchWherePredicate`, `canonicalUriExpr`).

These are not substitutes. The content-type tier captures real page views that
are not in the sitemap; the sitemap tier captures exactly the curated set and
excludes everything else by construction. Operators want both alongside the raw
all-traffic numbers.

Earlier framing (the superseded draft) treated the sitemap definition as the
single "real traffic" tier and the content-type definition as a deferred
evolution path chosen only when the sitemap `IN` list approached its scale
ceiling. Review concluded the two are complementary tiers, not alternatives, and
should both ship.

### `sc-content-type` availability: forward-only

Measured against the live `barlog.sk` tables:

- **v2 live delivery does not carry `sc-content-type` yet.** The live
  `cf_logs_table` has exactly ten columns because the CDK logging record-fields
  config requests only those. The `real` tier therefore populates **from the
  redeploy forward** once `sc_content_type` is added to `requiredRecordFields`.
- **Historical data is treated as wrong and is not recovered.** The v1 source
  table does contain `sc-content-type` (and current compaction drops it), so
  re-compaction _could_ recover history - but by decision that is out of scope.
  No re-compaction or history backfill is run. The compaction column map is
  still corrected so the code is right, but it is not executed for `barlog.sk`.

So the `real` and `watch` tiers have no historical data; both start accumulating
from the redeploy. This is intentional: historical totals are known to be
polluted (bot probes, the now-removed 404 rewrite), and a clean forward series is
more valuable than a reconstructed noisy one.

The CloudFront `404 -> /index.html (200)` rewrite is being removed by the
operator (treated as done), so forward v2 logs will not carry probe-redirect
noise. The `2xx`-only `real` predicate is a second line of defense regardless.

## Decision

Compute and store **three parallel tiers** of the same totals and
`status`/`country`/`device` breakdowns, each in its own namespace with its own
applied-marker namespace so they never collide, double-count, or interfere with
each other's backfills:

| Tier               | Namespace                              | Athena predicate (added to the time partition)                                     | Query-size cost |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| **all** (existing) | `totals#…` / `breakdown#…`             | none                                                                               | O(1)            |
| **real**           | `totals#real#…` / `breakdown#real#…`   | `sc_content_type LIKE 'text/html%' AND sc_status BETWEEN 200 AND 299`              | O(1)            |
| **watch**          | `totals#watch#…` / `breakdown#watch#…` | `canonical(cs_uri_stem) IN ('/','/blog',…)` over active `source="sitemap"` entries | O(sitemap size) |

- **all** is unchanged: every row, no filter, the raw denominator.
- **real** is a content-type + status filter: genuine browser-served HTML page
  views. O(1) in query size, scales to any catalog, independent of the sitemap.
- **watch** is the curated sitemap set: traffic to exactly the pages the
  operator declared. Reuses the existing sitemap `IN`-list machinery.

#### Why the `real` predicate is `2xx` only (not `2xx/3xx`) and `LIKE`

A `301`/`302` is not a page view - it is a redirect **to** one - so counting
`3xx` would double-count and, under the old 404 rewrite, fold ~hundreds of
thousands of probe redirects into the metric. Inspection of the existing logs
showed `text/html` `3xx` rows outnumbering genuine `text/html` `2xx` views by
roughly half as many again. The predicate is therefore
`sc_status BETWEEN 200 AND 299`, which is correct independent of the CloudFront
fix.

The content type appears both as `text/html` and `text/html;%20charset=utf-8` in
real data, so the match is `LIKE 'text/html%'`, never `= 'text/html'`.

Each tier is one combined bucket (not per-URL); per-URL detail already lives in
the watch model (ADR-009).

### Storage: parallel namespaces, markers per tier

Mirror the existing shapes exactly; only the key prefix differs.

- Totals: `pk = "totals#<tier>#<grain>"`, `sk = <timeKey>`.
- Breakdowns: `pk = "breakdown#<tier>#<dimension>#<grain>#<periodKey>"`,
  `sk = <value>`.
- Applied markers: `pk = "applied#<tier>-<grain>#<periodKey>"`, `sk = "applied"`.

For the existing all-traffic tier the `<tier>#` / `<tier>-` segment is empty, so
its keys are unchanged. The read side
(`resolveTotalsLive`/`resolveBreakdownLive`) and the rollup summing
(`sumTotals`/`sumBreakdown`) are reused unchanged against the new keys. TTL
policy follows ADR-009: hourly tiers + markers carry the 90-day TTL; day/month
aggregates are kept forever.

**Separate markers per tier are the key operational property.** Backfilling the
`real#` or `watch#` tier never touches the all-traffic markers or data; the
three tiers can be (re)built independently and partial failures isolate per tier.

### Processing

- The hourly processor runs **up to two additional Athena queries** (clones of
  `buildHourlyQuery` with the tier predicate appended to the WHERE) and writes
  each tier's totals + breakdowns with `ADD`, each guarded by that tier's hourly
  marker. Country reuses the existing top-IP -> IPinfo enrichment.
- The **watch** tier is skipped entirely (writes nothing, no query) when the
  active sitemap set is empty, so an unconfigured sitemap never triggers a
  full-table scan.
- Daily/monthly rollups for each tier sum the finer stored tiers, identical to
  the all-traffic rollups, under that tier's day/month markers.
- Backfill recomputes history per tier (see below).

### Backfill: a `--force` flag on the backfill CLI, scoped to the tier

History is populated by the existing backfill CLI, which already drives
`processHour` under the marker guard (`applied` vs `skipped`). Two additions:

- A `--tier <all|real|watch>` (repeatable) selector so an operator backfills a
  specific tier's namespace without touching the others.
- A `--force` flag that **ignores the applied marker and overwrites** the
  target tier for the range. This is the correct lever for the one-off reprocess
  needed when a tier's definition or inputs change (e.g. after `sc_content_type`
  is added). It lives only on the operational backfill CLI - not on the
  scheduled Lambda - because "recompute history" is exactly what backfill is
  for; it is a normal operator affordance, not a pipeline footgun. It affects
  only the stack the operator runs it against and only the selected tier.

`--force` replaces the alternative of commenting out the marker check in source
before an ad-hoc run and reverting before publish - that approach is error-prone
(risk of publishing the commented state) and leaves no reusable tool.

### Read side

A `tier: "all" | "real" | "watch"` selector threads through the
`getBreakdown`/`getTotals` remote queries into
`resolveTotalsLive`/`resolveBreakdownLive`, selecting the namespace. No new
resolver logic - only the key prefix changes. The dashboard adds a tier selector
on the Totals and Breakdowns pages.

### Prerequisites and scope for the `real` tier

Forward-only, no history:

1. Add `sc_content_type` to `requiredRecordFields`, `columnMap`, and the Glue
   column map, and redeploy so delivered v2 logs carry it. The `real` tier
   populates from this point forward.
2. The `404 -> /index.html` rewrite removal is treated as done by the operator.

Historical data is treated as wrong and is **not** backfilled or re-compacted.
The `compactColumnMap` is corrected (so the code is right for future use) but is
not executed for `barlog.sk`. The `watch` tier likewise accumulates forward from
the redeploy; it is not backfilled over history for `barlog.sk`.

The `--tier` + `--force` backfill levers still ship as general operator tooling
(another project may want to backfill), but running them is out of scope here.

### Explicitly out of scope

- Per-URL real/watch breakdowns (the watch model already covers per-URL).
- Manual watch entries as a tier (the `watch` tier is sitemap-only by decision;
  manual entries like `/images+`, `/assets+` stay a byte-volume measuring tool
  and must not contaminate a page-view metric).

## Rationale

### 1. Three tiers answer three different questions

Raw volume (all), honest page views (real, content-type), and curated-page
traffic (watch, sitemap) are distinct operator questions. Collapsing real and
watch into one "real traffic" tier forced a false choice; shipping both, plus
the untouched all tier, is strictly more informative and each is cheap.

### 2. Parallel namespaces, not read-time filters

The all-traffic totals/breakdowns are stored pre-aggregated and are not status-,
content-type-, or URL-partitioned, so neither narrowing can be derived from them
on read. A stored per-tier aggregation is unavoidable. Isolating each under its
own namespace with its own markers keeps them fully decoupled.

### 3. The content-type tier is O(1) and forward-honest

`sc_content_type LIKE 'text/html%' AND sc_status BETWEEN 200 AND 299` adds a
single column read and no per-URL list, so it scales to any catalog size. It
counts only `2xx` HTML responses, so it is honest regardless of the CloudFront
404 behavior; the 404 fix (treated as done) additionally stops probe redirects
from being logged at all.

### 4. Reuse the sitemap machinery for the watch tier

The watch query already filters CloudFront rows by canonical URI, sitemap URLs
are already materialized as watch entries, and the slash-fold canonicalization
is already shared (`canonicalUriExpr` / `canonicalPath`). The watch tier needs
only a new aggregation applying the existing predicate to the full
totals/breakdowns GROUPING SETS.

### 5. `--force` on the backfill CLI is the right reprocess lever

Backfill already recomputes history under the marker guard. A tier-scoped
`--force` overwrite is a natural, publishable operator affordance and avoids both
marker-ignoring source hacks and any change to the scheduled pipeline.

## Consequences

- Up to two extra Athena queries per hour and a parallel set of DynamoDB items
  roughly the size of the existing totals + breakdowns per tier. On the measured
  data this is negligible (see Cost).
- The `real` and `watch` tiers have no historical data; both accumulate forward
  from the redeploy. Historical totals are known to be polluted and are
  deliberately not reconstructed.
- Each tier is defined by its inputs **at processing time** (the sitemap set, or
  the logged content type). Reprocessing a period with `--force` adopts the
  current definition for that period; already-processed periods keep theirs.
  This matches the existing temporal behavior of `syncSitemapWatch`.
- A genuine HTML view absent from the sitemap is counted in `real` but not in
  `watch` - which is precisely why both tiers exist.

## Cost

Measured against the live `barlog.sk` v2 logs (eu-central-1, $5.00/TB scanned):

- Entire log history on S3: **1,262 objects, 5.22 MB total.**
- Column-pruned Athena scan of the real query columns: **~0.015 MB for one
  hour, ~0.25 MB for one day, ~0.80 MB for one month.**
- Athena bills a **10 MB minimum per query**, far above the actual scan, so the
  per-query floor dominates - not data volume.

Ongoing, the two added tiers are two extra hourly queries:
`2 x 24 x 30 = 1,440` queries/month at the 10 MB floor = ~14.4 GB billed =
**~$0.07/month incremental.** No history backfill is run for `barlog.sk`, so
there is no one-time backfill cost. DynamoDB cost (small on-demand items under
the 90-day hourly TTL) is a fraction of a cent. Athena cost is not a constraint
at this scale.

## Alternatives Considered

### A single "real traffic" tier (sitemap-only), content-type deferred

Rejected as the final shape (it was the earlier draft). It forced an either/or
between two complementary views and omitted genuine page views absent from the
sitemap. Shipping both tiers is cheap and strictly more useful.

### Real traffic = all watched entries (manual + sitemap)

Rejected. Folds asset/image watches (`/images+`, `/assets+`) - which exist to
measure byte volume - into the page-view metric, corrupting it. The watch tier
is sitemap-only; manual entries stay a separate measuring tool.

### Read-time filter over the existing all-traffic breakdowns

Rejected as infeasible. `totals`, `device`, and `country` are not status-,
content-type-, or URL-partitioned, so a correct cross-dimensional narrowing
cannot be reconstructed from stored all-traffic data. Parallel aggregation is
required.

### Backfill by commenting out the marker check in source

Rejected in favor of a `--force` flag on the backfill CLI. The source-edit
approach risks publishing the commented state and leaves no reusable tool; a
tier-scoped `--force` is the standard, publishable operator affordance for a
one-off full reprocess.

## References

- ADR-009 - unified watch model (the URL-filtering pipeline, sitemap sync, and
  the live-`ADD`/backfill-`SET` + marker discipline reused here)
- ADR-004 - atomic writes and idempotency (marker + `ADD` discipline)
- ADR-002 - single-table key schema (the `real#`/`watch#` namespaces reuse the
  shared table and reverse GSI)
- `src/athena.ts` `buildHourlyQuery` - the query cloned and given each tier's
  predicate; `requiredRecordFields` / `columnMap` - extended with
  `sc_content_type` for the `real` tier
- `src/sql.ts` `canonicalUriExpr` - the shared slash-fold used in the watch
  predicate
- `command/backfill.ts` - the CLI gaining `--tier` and `--force`
- `command/compact.ts` `compactColumnMap` - corrected to include
  `sc-content-type` for future compactions; not re-run for `barlog.sk` (history
  is out of scope)
- `.kiro/plans/real-traffic-breakdowns.md` - the implementation plan
