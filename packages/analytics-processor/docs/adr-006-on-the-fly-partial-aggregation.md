# ADR-006: On-the-fly Partial Aggregation for In-Progress Periods

## Status

Accepted

## Context

Totals and breakdowns are rolled up on a schedule: the daily rollup runs for
_yesterday_ and the monthly rollup for _last month_ (see ADR-004). This means
the aggregate record for the current, in-progress period does not exist yet:

- The current day has no `totals#day` / `breakdown#…#day#…` record until the
  next day's rollup runs.
- The current month likewise has no `month` aggregate until next month.
- A past period can also be temporarily missing if its rollup has not run yet
  (schedule lag, a failed invocation, a gap being backfilled).

Reading the aggregate directly therefore shows the current period as empty — a
dashboard viewing "today" at 11:00 would show nothing until tomorrow, which
reads as data loss to the user even though the finer-grained hourly records
exist and are correct.

## Decision

Resolve a bucket's value on the fly from the grain below it when it is not
"sealed", via `resolveTotalsLive` / `resolveBreakdownLive`:

- A period is **sealed** when it is strictly in the past _and_ its rollup marker
  (`applied#<grain>#<periodKey>`) is present. Sealed periods are read directly
  from their stored aggregate — cheap, and identical to the persisted rollup.
- Any other period (the current in-progress period, or a past period still
  missing its marker) is **summed from its children**, which are themselves
  resolved live. The recursion bottoms out at `hour`, the terminal grain, read
  directly. So the current month folds through its sealed days plus the current
  day, and the current day sums the hours ingested so far.
- An in-progress period is capped at `now`: the current day enumerates hours
  `00..currentHour`, the current month enumerates days `01..currentDay`. It
  never looks into the future.

Each level reads its children with a single ranged query (one hourly
`queryWindow` for a day, one daily `queryWindow` for a month) rather than a get
per child, keeping the fan-out bounded (a live current year reads ~12 months +
~31 days + ~24 hours).

The computation reuses the same `sumTotals` / `sumBreakdown` reducers the
rollups use, so the live view and the eventual persisted rollup agree by
construction.

## Rationale

### 1. One definition of "a day is the sum of its hours"

The live fallback and the scheduled rollup are the same computation over the
same reducers. Keeping them in one package means a new additive field cannot
make the live view and the stored rollup disagree.

### 2. Self-healing gaps

Because a past period without its marker is treated as unsealed, a missing or
delayed rollup is transparently filled from the finer grain until the rollup
lands, rather than showing a hole.

### 3. Bounded, batched reads

Resolving per level with a single ranged query (never a get-per-bucket loop)
keeps read amplification small and predictable.

## Consequences

- Reads for the live edge do more work than a single `GetItem` (a handful of
  ranged queries), traded for always-fresh current-period data. Sealed history
  stays a single cheap read.
- Historical live resolution is bounded by the hourly TTL: once hourly records
  age out, a past period that never sealed can no longer be reconstructed. In
  practice past periods seal within a day, well inside the TTL.
- The dashboard must provide an `AppliedMarkers` reader to distinguish sealed
  from in-progress periods.

## Alternatives Considered

### Compute the fallback in the dashboard

Rejected: it would duplicate the summing logic and the "sealed" definition
outside the package that owns the rollups, inviting the live view and the
persisted rollup to drift. The dashboard stays a thin UI.

### Eagerly roll up the current period on every read/write

Rejected: writing an aggregate for an incomplete period would either need
constant rewrites or leave a stale partial record that the next real rollup
must reconcile. Computing on read keeps a single source of truth (the hourly
records) and avoids partial-write reconciliation.

## References

- ADR-004 (atomic writes and idempotency markers)
- `src/resolveLive.ts`, `src/reduce.ts`
