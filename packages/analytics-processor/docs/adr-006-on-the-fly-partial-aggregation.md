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

Resolve a bucket's value on the fly from exactly one grain finer, following
only the current edge deeper, via `resolveTotalsLive` / `resolveBreakdownLive`:

- A period is **sealed** when it is strictly in the past _and_ its rollup marker
  (`applied#<grain>#<periodKey>`) is present. Sealed periods are read directly
  from their stored aggregate — cheap, and identical to the persisted rollup.
- Otherwise the period is the sum of its children at the **next finer grain**,
  where every already-complete child is taken from its **stored aggregate** and
  only the single in-progress child is resolved recursively (one level deeper):
  - partial day = stored/queried hours `00..currentHour`
  - partial month = stored day aggregates `01..currentDay-1` + the partial
    current day (which itself resolves from hours)
  - partial year = stored month aggregates `01..currentMonth-1` + the partial
    current month
- A partial month therefore **never** fans out to hours for its finished days —
  it trusts their day aggregate. Only the one current day drills into hours.
  This both matches the mental model (a month is the sum of its days) and keeps
  the read count small.
- An in-progress period is capped at `now` and never looks into the future.

Each level reads its children with a single ranged query, keeping the fan-out
bounded along a single spine (a live current year touches ~12 months + ~31 days

- ~24 hours — tens of reads, not the hundreds a deeper cascade would require),
  so the request stays sub-second.

The computation reuses the same `sumTotals` / `sumBreakdown` reducers the
rollups use, so the live view and the eventual persisted rollup agree by
construction.

### Bucket state for the UI

`classifyBucketState` labels each bucket so the dashboard can tell "no traffic"
apart from "not calculated yet":

- **sealed** — finalized rollup (marker applied); a zero-hit sealed bucket is
  genuine no-traffic.
- **partial** — in-progress, computed live, value present but may still grow.
- **pending** — not sealed and nothing computable yet (awaiting processing).

Classification is marker-driven rather than time/lag-driven: a bucket is sealed
exactly when its rollup actually ran, which is more accurate than inferring
from a processing-lag window.

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
