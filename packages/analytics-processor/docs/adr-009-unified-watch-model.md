# ADR-009: Unified Watch Model, URL Directory, Uniques, and TTL Policy

## Status

Accepted

Supersedes ADR-007 (Sitemap URL Stats as a Separate Parallel Model). The sitemap
stats model (`SitemapUrlStats` and its hourly/monthly processors) is retired and
folded into the watch model described here; the sitemap parsing/fetch helpers
(`fetchSitemapPaths`, `parseSitemap`, `normalizeSitemapLoc`, `canonicalPath`) are
kept and reused.

## Context

The analytics pipeline aggregates CloudFront logs into additive per-period
totals and site-wide `status`/`country`/`device` breakdowns, rolled up to
permanent day and month aggregates. Two gaps motivated this change:

1. ADR-007 introduced a sitemap-only per-URL stats model keyed on
   `sitemapurl#<path>`. It tracked only hits, was wired to its own hourly Lambda
   and schedule, and could not express anything other than one-exact-URL-per-row
   sourced from the sitemap. Operators also want to watch URL _prefixes_ (a whole
   section) and to add their own entries by hand, not just whatever the sitemap
   lists.
2. There was no catalog of every URL CloudFront has actually served, so there
   was nothing to browse or to promote into a watchlist, and no surfaced
   unique-visitor metric at any grain.

The package is 0.x with no external consumers of the retired model, so there is
no backward-compatibility constraint on replacing it.

## Decision

Replace the sitemap stats model with a single **unified watch model**, add a
metric-free **URL directory**, add **approximate unique-visitor** figures at day
and month grain, and fix the **TTL policy** so every durable aggregate tier is
kept indefinitely.

### Unified watch model

A watch entry is a bounded, operator-or-sitemap-sourced instruction to collect
the full metric set for a URL or a URL prefix. It has three orthogonal fields,
each a string-literal union stored structurally (no `*`/`+` sugar at this layer;
that parsing lives at the dashboard boundary):

- `mode` (`watchModes = ["exact", "split", "group"]`): `exact` matches one
  slash-collapsed URI; `group` matches a prefix and collapses everything under it
  into one bucket; `split` matches the same prefix but fans out to one bucket per
  path beneath it.
- `source` (`watchSources = ["sitemap", "manual"]`): where the entry came from.
  Sitemap sync owns `sitemap` entries; operators own `manual` entries.
- `status` (`watchStatuses = ["active", "stopped"]`): `active` collects;
  `stopped` keeps all history and stops collecting, and is fully reversible.

Config rows live at `pk = "watch#<matcher>", sk = "config"` (one row per entry,
so the set can grow) and are listable via the reverse index
(`sk = "config" AND begins_with(pk, "watch#")`). Metric rows live at
`pk = watch#<matcher>` (or `watch#<prefix>#<path>` for `split`), `sk = "<YYYY-MM>"`
with flat `dNN` day attributes for `hits` and month-level scalars for
`bytesSent`, `cacheHits`, `cacheMisses`, `cacheErrors`, `bytesSaved`, `errors`
(4xx+5xx), and `redirects` (3xx). Every watch entry collects the same metrics and
renders in the same view regardless of mode or source.

Collection stays cheap because the set is bounded: `processWatchHour`
(`ADD` + per-entry-per-hour applied marker, `periodKey = "<matcher>#<hourKey>"`)
on the live cron and `processWatchMonth` (idempotent `SET` overwrite, no marker)
for backfill, mirroring the live-vs-backfill split from ADR-007 §1.

Sitemap sync moves off its own hourly Lambda into the daily rollup (and runs
immediately on config change via the SDK `syncSitemapNow` command). It fetches
the configured sitemap, upserts each path as an `active` `source="sitemap"`
`exact` entry, and sets entries dropped from the sitemap to `stopped` (never
deleting them); a returning path flips back to `active`.

### URL directory

A metric-free catalog at `pk = <normalized url>, sk = "url"` carrying only
`firstSeen`. The daily rollup upserts every URL seen that day with a blind
`SET firstSeen = if_not_exists(firstSeen, :day)`, so repeat days are idempotent
one-WCU no-ops. There is no `lastSeen` (it would churn a write every day for
every live URL). The directory is what the dashboard lists and what an operator
promotes into a watch entry.

### Uniques (non-additive)

Unique visitors are Athena `approx_distinct(ip)`, stored as plain numbers, never
summed:

- Day uniques (site-wide and per country) are computed in the daily rollup.
- Month uniques are a **fresh** whole-month Athena scan in the monthly rollup,
  NOT a sum of the daily figures.
- No yearly uniques.

### TTL policy

- Hourly totals, hourly breakdowns, and hourly/watch idempotency markers keep the
  90-day TTL (`hourlyTtlDays`) — they are cheap-to-recompute from Athena raw logs.
- Every aggregate tier — day/month totals and breakdowns, watch metric records,
  the URL directory, and the stored uniques — has **no TTL** and is kept forever.

## Rationale

### 1. One model instead of a sitemap-special-case

ADR-007's model could only express "one exact sitemap URL, hits only". The watch
model generalizes the entity along the two axes operators actually asked for —
prefix matching (`group`/`split`) and manual authorship (`source="manual"`) —
and widens the metric set to the full cache/bytes/error/redirect picture, while
keeping ADR-007's proven storage shape (flat `dNN`, `(pk, YYYY-MM)` rows, reverse
index for month reads) and its live-`ADD`/backfill-`SET` cost split. Retiring the
parallel sitemap stats model removes a whole Lambda, schedule, and query family
for one unified path.

### 2. The URL directory is a catalog, not a metric store

Per-URL _hourly_ metric records would be unbounded: junk and scanner URLs have
unbounded cardinality, exactly the long tail that makes a top-N path breakdown
collapse into `__other__`. The directory sidesteps that by storing only
`firstSeen` per URL — read-cheap, write-cheap, and bounded in write cost by the
once-per-day cadence — and leaves actual metric collection to the bounded watch
set. This is why per-URL detail is strictly opt-in via a watch entry.

### 3. Uniques are non-additive, so they are recomputed, never summed

`approx_distinct` over a union is not the sum of `approx_distinct` over the
parts: a visitor active on two days counts twice if you add daily figures. So the
day figure is computed from that day's logs and the month figure from a fresh
scan of the whole month, each written directly by its rollup and never fed
through an additive `ADD`. Storing them as plain `== null`-safe numbers keeps the
read path trivial for the dashboard.

### 4. Per-country uniques only; no finer unique cut

Per-country day/month uniques are feasible because CloudFront logs carry the
client IP and the daily rollup already resolves country for the breakdowns. Any
_finer_ per-unique dimension is infeasible on the current schema: there is no
country column in the Athena logs — country is derived externally from the IP via
IPinfo at breakdown time, not present per row — so a grouped
`approx_distinct(ip)` can only group by columns the logs actually contain. A
yearly unique would additionally need either a yearly Athena pass or HLL
sketches; both are out of scope.

### 5. TTL only where recompute is cheap

The 90-day TTL exists purely for cost control on the high-cardinality hourly tier
and its markers, all of which are recomputable from Athena raw logs. The
aggregate tiers are the durable record — the whole point of the day/month/watch
rollups and the directory is long-horizon, year-over-year comparison — so putting
any TTL on them would silently destroy exactly the history they exist to keep.
Hence: TTL on hourly + markers, none on aggregates.

## Consequences

- The retired sitemap stats model's stored `sitemapurl#` items are left to sit
  unused (they have no TTL under ADR-007 §5); they are harmless but not read. A
  future cleanup can purge them.
- The standalone sitemap Lambda and its hourly schedule are removed; the daily
  rollup and the SDK write path now own sitemap sync. The two rollup Lambdas gain
  Athena/Glue/S3 access for the uniques scans (wired in Task 6).
- Dashboard code that imported the retired `SitemapUrlStats` /
  `SitemapUrlStatRecord` API breaks until the dashboard is migrated to the watch
  model (handled in a later task).
- Hard-deletion of a watch entry's historical metric records is out of scope:
  `deleteWatch` removes only the config row; metric rows linger for a future
  cleanup.

## Alternatives Considered

### Keep the sitemap stats model and add watched patterns beside it

Rejected. Two parallel per-URL models (sitemap-sourced exact-only, plus a second
pattern model) would duplicate storage shape, query helpers, markers, and
dashboard views for no benefit. A single entity with `mode`/`source`/`status`
subsumes both.

### Per-URL hourly metric records for every served URL

Rejected on cardinality. Junk/scanner traffic makes the served-URL set unbounded;
fat per-URL-per-hour documents would blow up write cost and item count. The
bounded watch set plus the metric-free directory gives per-URL detail only where
an operator opted in.

### Sum daily uniques into the month figure

Rejected as incorrect. `approx_distinct` is non-additive; summing double-counts
cross-day visitors. The month figure must be a fresh scan of the whole month.

### Per-country uniques stored additively alongside hits

Rejected. Uniques cannot be `ADD`ed like hits without corrupting the count, so
they are written by the rollup as non-additive scalars, distinct from the
additive hit/byte/cache counts.

## References

- ADR-002 — single-table key schema (shared table and reverse GSI reused here)
- ADR-004 — atomic writes and idempotency (the per-hour marker + `ADD` discipline
  the watch hourly path follows)
- ADR-007 — the superseded sitemap URL stats model
- `.kiro/plans/unified-analytics-watch-model.md` — full feature plan
