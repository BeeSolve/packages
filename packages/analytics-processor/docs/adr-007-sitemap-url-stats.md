# ADR-007: Sitemap URL Stats as a Separate Parallel Model

## Status

Accepted

## Context

The hourly pipeline aggregates CloudFront access logs into per-period totals and
a top-N `path` breakdown. Any path outside the top-100-by-hits in a given hour
collapses into a single `__other__` bucket at ingestion time, and its identity
is lost permanently.

This is not a theoretical edge case. Bots and attack traffic hammer junk URLs
(`/wp-login.php`, `/.env`, random probes), and those junk paths routinely win
the top-100 slots per hour. Genuine blog articles - the thing we actually want
to measure - get swept into `__other__`. Once an hour is stored, filtering
`__other__` at query time cannot recover anything: the per-article counts were
never written. The data is gone.

We want to answer "which article was read most in May 2026 vs June 2025"
without junk and without `__other__` loss. The set of URLs we care about is
knowable in advance: it is the site's sitemap (e.g.
`https://example.com/sitemap.xml`).

The package is 0.x and this model has no existing consumers, so there is no
backward-compatibility constraint on introducing a new entity.

## Cost Analysis

This is the analysis that drove the live-vs-backfill write-mode split in the
Decision. The numbers are order-of-magnitude guesstimates (an LLM-run estimate,
not a measured bill), parameterized on one unknown: how many bytes **one hour**
of CloudFront logs occupies as compressed Parquet, projecting only the ~10
columns the processor reads. Treat them as "which option, and by how much," not
as a precise forecast. Re-run with a real `MB/hour` once the log bucket has a
few days of data if a hard number is needed.

### Pricing facts used

- **Athena**: $5.00 per TB scanned, **10 MB minimum billed per query**. Scanned
  bytes are bounded by _partition pruning_, not by how many buckets you
  `GROUP BY` - so one query over a month's partitions scans the same bytes as
  720 one-hour queries, but pays the 10 MB floor once instead of 720 times and
  issues 1 execution instead of 720.
- **DynamoDB on-demand** (the table is `Billing.onDemand()`): WRU $1.25/M
  (1 WRU = 1 KB written), RRU $0.25/M (1 RRU = 4 KB read). A **transactional**
  write costs **2x WRU**. A sitemap stat item is well under 1 KB -> 1 WRU per
  non-transactional write.

### Model A - recompute whole month every hour (`SET`)

Each of the ~720 hourly runs/month scans the month-to-date (grows through the
month) and overwrites every URL item.

- Athena: sum over the month of (month-to-date bytes) per run.
- DynamoDB: 720 runs x URL_count non-transactional writes (1 WRU each), no reads.

### Model B - incremental one hour (`ADD` + marker)

Each hourly run scans one hour and writes transactionally (marker + per-path
`ADD`s, 2x WRU), plus one tiny marker `GetItem` (1 RRU) to short-circuit applied
hours.

- Athena: 720 x max(1 hour of bytes, 10 MB floor).
- DynamoDB: 720 marker reads (~$0.0002 total - negligible) + 720 x (marker +
  URL_count) writes at 2x WRU.

### Estimated monthly totals (small site: 5 MB/hour of projected Parquet)

| URLs | Model         | Athena | DDB write | DDB read | **Total/mo** |
| ---- | ------------- | ------ | --------- | -------- | ------------ |
| 50   | A recompute   | ~$6.70 | ~$0.045   | $0       | **~$6.74**   |
| 50   | B incremental | ~$0.04 | ~$0.092   | ~$0.0002 | **~$0.13**   |
| 200  | A recompute   | ~$6.70 | ~$0.18    | $0       | **~$6.88**   |
| 200  | B incremental | ~$0.04 | ~$0.36    | ~$0.0002 | **~$0.40**   |
| 1000 | A recompute   | ~$6.70 | ~$0.90    | $0       | **~$7.60**   |
| 1000 | B incremental | ~$0.04 | ~$1.80    | ~$0.0002 | **~$1.84**   |

Athena scales with traffic (bytes/hour), so at higher volume Model A's Athena
line grows to tens or hundreds of dollars/month while Model B stays near the
10 MB floor - the gap reaches ~40x (tiny) to ~370x (medium/large) in scanned
bytes.

### What the numbers show (and why the design is a hybrid)

1. **The markers are nearly free.** 720 tiny `GetItem`s/month ~ $0.0002. The
   marker was the thing we worried about; it is not a cost factor.
2. **The real DynamoDB cost is the transactional 2x write penalty**, and it
   grows with URL count - at 1000 URLs, Model B's DynamoDB write ($1.80) exceeds
   its own Athena line and most of Model A's non-Athena cost. But it is still
   cheaper overall because Athena dominates.
3. **Athena is the deciding line, and it is pure direction-of-travel.** Going
   _forward_ you only ever have one new hour, so re-scanning the month 720 times
   is 40-370x waste -> incremental `ADD` wins. Going _backward_ the whole month
   already exists, so one scan grouped by `(day, path)` is strictly cheaper than
   720 one-hour scans -> recompute `SET` wins.

Hence the split: the live cron uses incremental `ADD` + marker; the backfill
command uses monthly recompute + `SET`. Same stored result either way; each path
takes the cheaper Athena route for its direction. The absolute dollars are small
for a low-traffic blog ($1-7/mo), but the ratio is large and grows with traffic,
and the backfill saving (1 query vs 720 per month) is unambiguous.

## Decision

Add a **separate, parallel data model** for the known set of sitemap URLs,
decoupled from the hourly/rollup pipeline. It is additive: no existing key
schema or logic changes.

**Item layout - one item per `(path, year-month)` in the shared table:**

```
pk:   "sitemapurl#<path>"      e.g. "sitemapurl#/blog/getting-started"
sk:   "<YYYY-MM>"              e.g. "2026-05"
path: "<path>"                 denormalized for the reverse-index read
month:"<YYYY-MM>"
d01:  <hits>                   flat per-day attributes, d01..d31 (only days with data)
d02:  <hits>
...
hits: <month total>           denormalized month rollup
updatedAt: <epoch ms>
```

- **PK = `sitemapurl#<path>`, SK = `<YYYY-MM>`** - query one URL across many
  months on the main table (`#pk = :pk`, SK `BETWEEN` for a month range).
- **Reverse GSI (`sk` -> `pk`, already on the table)** - query all URLs for one
  `YYYY-MM`. The sort key must be constrained with
  `#sk = :month AND begins_with(#pk, "sitemapurl#")`: the reverse GSI is keyed on
  `sk` alone, and the totals rollup (`pk = totals#month`, `sk = <YYYY-MM>`, see
  ADR-002) shares the same month sort key, so a bare `#sk = :month` also returns
  that record and parsing rejects it.
- Flat `d01..d31` attributes, no nested `days` map.
- No TTL - these are long-lived historical comparison items.

**Ingestion - incremental `ADD` per hour, exactly-once via markers,
decoupled.** A dedicated sitemap processor Lambda runs hourly and does two jobs:

1. **Resolve the sitemap paths**: fetch the configured sitemap URL, parse
   `<loc>` entries, and normalize each to a path. The resolved set is used only
   for this run and is not persisted - only the sitemap URL is stored (on
   `system#config` / `analytics`).
2. **Add one hour's hits**: run one Athena query grouped by `path` for the
   single lagged target hour, restricted to the sitemap paths, then for each
   `(path, month)` `ADD` the hour's hits into that day's `dNN` attribute and the
   `hits` month rollup. The write is done in a `TransactWrite` alongside a
   conditional applied-marker (`applied#sitemap#<hourKey>`) so the hour is
   counted at most once even under retries or overlapping runs.

The sitemap URL lives on the config item, is refetched hourly, and is editable
from the dashboard. All hits are counted - there is no bot filtering.

**Backfill - monthly recompute-and-overwrite.** Backfill is the mirror image of
the live cron. Going backward over an already-complete month, scanning the whole
month in one Athena query (`GROUP BY (day, path)`) and overwriting each
`(path, month)` item with `SET` is far cheaper than replaying 720 single-hour
`ADD`s, and `SET` is idempotent so no marker is needed. The two paths share the
model and query helpers but use opposite write modes, each matched to its cost
profile. See rationale 1.

## Rationale

### 1. Incremental `ADD` per hour (live) vs recompute-and-overwrite (backfill)

Each run scans only the single lagged target hour (the same slice the main
hourly pipeline processes) and `ADD`s its per-path hits into the running
`(path, month)` counters. An earlier revision recomputed the whole current
month from Athena every hour and overwrote the item with `SET`. Both converge on
the same monthly totals, but the recompute model re-scans an ever-growing slice
(month-to-date) on every one of ~720 runs a month, whereas the incremental model
scans each hour exactly once. On Athena's $5/TB-scanned pricing that is the
dominant cost difference - see the Cost Analysis section above for the
assumptions and the per-model estimate table (~$0.13-1.84/mo incremental vs
~$6.74-7.60/mo recompute at a small site, a 40-370x scanned-bytes gap that grows
with traffic). That gap is the reason the live cron uses the incremental model.

Correctness under `ADD` requires exactly-once application, which the per-hour
applied-marker provides: the marker's conditional `Put` shares the
`TransactWrite` with the stat `ADD`s, so a replayed hour is a no-op. This is the
same marker machinery the hourly totals/breakdowns pipeline already uses.

Backfill inverts the trade. An operator backfilling a past month already has the
whole month present, so one Athena scan grouped by `(day, path)` returns every
per-day total at once - 1 query instead of 720, the same scanned bytes a single
recompute would cost. There the write is `SET` (overwrite), which is idempotent
by construction and needs no marker. So the module ships both: the live cron
uses `processSitemapHour` (`ADD` + marker) and the backfill command uses
`processSitemapMonth` (recompute + `SET`), each the cheaper choice for its
direction of travel.

### 2. Flat `dNN` attributes instead of a nested `days` map

A per-day count is a top-level attribute (`d14`), written with `ADD d14 :hits`.
There is no parent map to bootstrap and no init race (a nested
`days.14 = :v` requires `days` to already exist, and `ADD` on a map path is not
available the same way). A single `GetItem` still returns the whole month, and a
write touches only the day the processed hour belongs to.

### 3. PK = path, SK = month, with the reverse GSI serving month -> path

The two access patterns are "one URL over time" and "all URLs in a month". The
first is a bare-`pk` Query with a `BETWEEN` on the month `sk`; the second is a
Query on the already-existing reverse index (`sk` -> `pk`) keyed by the month and
constrained to the `sitemapurl#` partition prefix (`begins_with` on the index
sort key) so sibling families sharing the month `sk` are excluded.
Both are served from the shared table and the existing reverse GSI, with no new
index and no `Scan`.

### 4. All hits counted, no bot filtering

The count is total request hits, including bots. This is a locked decision: the
comparison we want ("most-read article") is meaningful even with bot noise, and
excluding bots is a separate, additive dimension. A bot-excluded `humanHits`
measure is explicit future work (a non-bot filter in the hourly query plus a
parallel stored measure), not part of this model.

### 5. No TTL on stat items (markers do carry a TTL)

The `(path, month)` stat items are the opposite of transient: the whole point is
year-over-year historical comparison, so they must persist indefinitely. The
per-hour applied-markers, by contrast, are transient bookkeeping and carry a TTL
(reusing `HOURLY_TTL_DAYS`), so they expire once the hour can no longer be
re-ingested.

### 6. Slash-collapsing path canonicalization on both sides

Sitemap `<loc>` values are absolute URLs; CloudFront logs the path as
`cs-uri-stem`. A single `canonicalPath` rule is applied identically to both:
strip to the `pathname`, then collapse a single trailing slash (`/blog/` ->
`/blog`), while preserving root `/`. The site 301-redirects `/blog/` -> `/blog`,
and the redirect itself is a logged hit, so without this both `/blog/` and
`/blog` would be distinct and the redirect traffic would be stranded.
Canonicalizing the stored sitemap path **and** the logged `cs-uri-stem` (as an
equivalent SQL expression in the Athena query, used in both the `GROUP BY` and
the `WHERE ... IN`) guarantees the two sides agree, so `/blog` and the redirect
hit on `/blog/` both count against `/blog`.

## Consequences

- The change is additive. No existing key schema, item layout, or pipeline logic
  changes; the new `sitemapurl#` partition prefix sits alongside the existing
  ones.
- The sitemap function makes an outbound HTTPS call to fetch the sitemap. No VPC
  is configured on these functions, so default internet egress applies - no
  extra networking is wired up.
- A given hour is counted exactly once via its applied-marker. Because the live
  cron writes incremental `ADD`s, re-running a processed hour is a no-op (the
  marker's conditional `Put` fails and the whole transaction is skipped). To
  re-ingest a month from scratch, run the backfill command: its monthly
  `processSitemapMonth` overwrites each `(path, month)` item with `SET`, so it
  cleanly replaces whatever the incremental path accumulated (no manual delete
  needed), as long as a single Athena source owns that month.
- When a month's logs are split across both the v1 and v2 Athena tables, process
  each hour (or backfill each month) from the single source that owns it;
  running both sources over the same period would double-count on the live path.
  A site with a clean v1 -> v2 date cutover has no period split across both
  tables in practice.
- Reads go through the `SitemapUrlStats` model (`getForUrl`, `getForMonth`),
  which reshapes `dNN` back into a `days` record on read; the live write path
  uses `buildAdd` (one `ADD` transaction item per path) and the backfill path
  uses `buildOverwrite`/`overwriteMany` (`SET`), so callers never construct keys
  or day attributes by hand.

## Alternatives Considered

### Recompute the whole month and overwrite with `SET`, on the live cron

Rejected on cost **for the live cron** (but adopted for backfill). It is
appealingly simple - idempotent by construction - but on the hourly schedule
every run re-scans the entire month-to-date in Athena. At $5/TB scanned that is
~40-370x the scanned bytes of the incremental model depending on traffic, for an
identical end result. The incremental model recovers idempotency cheaply with a
per-hour marker, so recompute's only advantage disappears going forward. Going
_backward_, though, recompute is the cheaper option (one scan per month vs 720),
so the backfill command deliberately uses it - the same technique, applied where
its cost profile wins.

### Incremental `ADD` into the existing breakdown items

Rejected. Reusing the lossy breakdown items would inherit the `__other__`
collapse that causes the data loss in the first place. The sitemap model keeps
its own `sitemapurl#` items and its own markers, decoupled from that pipeline.

### A nested `days` map instead of flat `dNN`

Rejected. Writing `days.14 = :v` (or adding to it) requires the parent `days`
map to exist first, which forces a bootstrap write and introduces an init race
between concurrent day writes. Flat top-level attributes support a bare
`ADD d14 :hits` with no bootstrapping.

### Query-time filtering of `__other__`

Rejected. The per-article counts are never written once a path falls out of the
top-100, so there is nothing to filter back out at query time. The data is
already lost at ingestion.

### Persisting the resolved sitemap path set

Rejected. An earlier revision stored the parsed `<loc>` path list (and a
fetched-at timestamp) back on the config item each run. Nothing ever read it:
the processor fetches, parses, and uses the paths in memory within the same run.
Persisting it added a write-only field that could grow toward the DynamoDB
400 KB item limit on a large sitemap and would always be stale relative to the
live fetch. Only the sitemap URL is persisted; the path set is re-derived on
each run.

## References

- ADR-002 - single-table key schema (shared table and reverse GSI this reuses)
- ADR-004 - atomic writes and idempotency (the per-hour marker + `ADD`
  discipline this model follows)
- `.kiro/plans/sitemap-url-stats.md` - full feature plan
