# General Pipeline Backfill: Single-Scan Optimization

## Status: Not Started (deferred - prerequisites first)

## Problem Statement

The general analytics backfill (`command/backfill.ts`) replays history by calling
`processHour` once per hour. Each call runs its own Athena query that scans a single
hour's partitions. For a long backfill this means one Athena query per hour -
e.g. a 12-month backfill is ~8,760 queries.

Athena bills on bytes scanned per query, with a 10 MB per-query minimum. Scanning
N hours as N separate queries scans the same total bytes as scanning them in one
query grouped by hour, but pays the per-query minimum N times, issues N Athena
executions (each with start/poll/fetch latency and overhead), and performs N× the
DynamoDB write round-trips. Going _backward_ over data that already exists in full,
we can collect a whole day or month in a single Athena scan and fan the results out
to the existing per-hour write path - far fewer, far cheaper queries for an
identical stored result.

This mirrors the decision already made for sitemap stats (ADR-007): the live cron
stays hour-at-a-time (`ADD` + marker), but backfill recomputes a wider window in one
scan. This plan brings the same idea to the main totals/breakdowns pipeline.

## Cost reasoning (preliminary - firm up with real numbers when scheduled)

Same pricing facts as ADR-007's Cost Analysis: Athena is $5/TB scanned with a
**10 MB per-query minimum**, and scanned bytes are bounded by partition pruning, not
by `GROUP BY` cardinality. So N single-hour queries and one N-hour query grouped by
hour scan the same bytes, but the per-hour approach pays the 10 MB floor N times and
pays N× the Athena start/poll/fetch overhead and DynamoDB round-trips.

- A 12-month backfill is ~8,760 hourly queries today. At the 10 MB floor that is
  ~8,760 × 10 MB = ~85 GB _minimum_ billed scan (~$0.43) even for a near-empty site,
  plus 8,760 executions' worth of latency/overhead - versus ~365 per-day queries
  (~$0.02 floor) or ~12 per-month queries for the same stored result.
- The win is dominated by eliminating the repeated per-query floor and the execution
  overhead/wall-clock, not by scanned-byte reduction (bytes are ~equal). For a busy
  site where each hour already exceeds 10 MB, the scanned bytes are genuinely equal
  and the win is purely fewer executions (latency, throttling headroom, DynamoDB
  round-trips).

When this is implemented, write a dedicated ADR capturing the measured/estimated
numbers (like ADR-007's Cost Analysis), the window-size choice (day vs month), and
the percentile/country/top-N constraints below, so the decision is reconstructable.

## Why this is deferred

There are other things to do first (tracked separately). This plan captures the
design so it is not lost; it is not scheduled yet. Do NOT start until the
prerequisites are cleared and the user explicitly schedules it.

## Constraints that make this harder than sitemap stats

The sitemap model is a pure additive sum, so a monthly `GROUP BY (day, path)` scan
fully reconstructs it. The general pipeline is not a pure sum, and three things must
be preserved:

1. **Percentiles do not compose.** Totals carry `approx_percentile(time_taken, 0.5)`
   and `0.95`. A month's p95 cannot be derived from 720 hourly p95s. The single wide
   scan must still compute the percentile _within each hour's group_ (so the stored
   hourly rows remain correct), not collapse the time dimension.
2. **Country enrichment is per-hour in Lambda.** `byCountry` comes from resolving the
   hour's top IPs through `IpInfoCache` (an external, cached lookup), not from the
   Athena query. The fan-out must still perform this per-hour enrichment.
3. **Top-N `__other__` folding is per-hour.** `byPath` keeps the top-N paths per hour
   and folds the rest into `__other__`. That cut is defined per hour and must stay so,
   or the stored hourly breakdown rows would differ from what the live cron produces.

The invariant to protect: **the hour is the atom.** Daily and monthly rollups are
built by summing finer-grain DynamoDB items (see `applyDailyRollup` /
`applyMonthlyRollup` in `processHour.ts`), so backfill must still produce genuine
per-hour rows. The optimization is "fewer Athena queries," not "coarser stored data."

## Approach

Collapse the Athena _scan_ without collapsing the stored grain:

- Add a windowed query that scans a whole day (or month) in one statement and
  `GROUP BY (hour, <existing grouping sets>)` - i.e. the existing `buildHourlyQuery`
  grouping sets, plus `hour` as an outer grouping key. Percentiles are computed per
  `(hour, ...)` group, so each hour's p50/p95 is correct.
- A new runner reshapes the result rows into a `Map<hourKey, HourlyAthenaResult>` -
  one `HourlyAthenaResult` per hour, identical in shape to what `runHourlyAthenaQuery`
  returns today.
- Backfill then iterates the hours of the window and, for each, runs the _rest_ of
  `processHour` unchanged: country enrichment (per-hour `IpInfoCache`), top-N folding,
  marker + `ADD` transaction. Only the Athena-scan step is shared; the write path,
  idempotency markers, and country logic are untouched.
- Window size is a tuning knob (day is the safe default; month is cheapest but
  produces a larger result set to page through). Start with per-day scans.

This keeps exactly-once (markers), keeps per-hour percentiles/country/top-N, and keeps
the rollup invariant, while cutting Athena executions ~24× (per-day) or ~720×
(per-month).

## Open questions to resolve before implementing

- Does Athena/Trino `approx_percentile` inside a `GROUP BY (hour, ...)` with
  `GROUPING SETS` behave acceptably, or do the grouping sets interact badly with the
  per-hour percentile? Prototype the SQL against the real v1/v2 tables first.
- Result-set size: a busy month grouped by `(hour, ip)` could be large (unique IPs ×
  hours). Confirm paging via `startAndFetchRows` is acceptable, or cap the window to a
  day.
- Should the live `runHourlyAthenaQuery` be refactored to sit on top of the windowed
  runner (window = 1 hour), to keep a single code path? Decide during implementation;
  avoid destabilizing the hot path.

## Tasks (sketch - flesh out when scheduled)

1. Prototype the windowed SQL (one day, `GROUP BY (hour, ...)` + grouping sets) against
   both v1 and v2 tables; validate per-hour percentiles and row counts. SQL-string +
   manual Athena validation.
2. Add `buildWindowedHourlyQuery` + `runWindowedHourlyQuery` returning
   `Map<hourKey, HourlyAthenaResult>`. Unit-test the SQL shape and the row→map reshape.
3. Add a backfill mode that scans per-day and fans out to the existing `processHour`
   write path (country + top-N + marker + `ADD` unchanged). Reuse `runPool`.
4. Keep the current per-hour backfill as a fallback flag; default to windowed.
5. Tests: windowed reshape produces per-hour results identical to N single-hour runs
   for a fixture; idempotency (markers) still holds; rollups unaffected.
6. ADR: document the live-vs-backfill scan asymmetry for the general pipeline (parallel
   to ADR-007 for sitemap).

## References

- ADR-007 (sitemap URL stats) - the live-`ADD` / backfill-recompute asymmetry this
  generalizes, and its Cost Analysis section (Athena/DynamoDB pricing facts and the
  per-model estimate table) that this plan's cost reasoning builds on.
- `src/athena.ts` `buildHourlyQuery` / `runHourlyAthenaQuery` - the per-hour scan to
  widen.
- `src/processHour.ts` - the write path, country enrichment, top-N folding, and the
  daily/monthly rollup invariant to preserve.
- `command/backfill.ts` - the current per-hour backfill loop.
