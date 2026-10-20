# ADR-002: No Yearly Grain for Breakdowns

## Status

Accepted

## Context

The Overview page offers four time grains: Hourly, Daily, Monthly, and Yearly.
The Breakdowns page (per-dimension tables for HTTP status, country, device)
offers only three: Hourly, Daily, Monthly. A user asked whether the missing
Yearly option on Breakdowns is intentional.

It is. The asymmetry is structural, rooted in how the two kinds of data differ
and how `@beesolve/analytics-processor` stores them.

The data model stops at the month grain:

- `grains` in the processor is exactly `["hour", "day", "month"]`, and the
  `Grain` type excludes `"year"`.
- Breakdown records are keyed `breakdown#<dimension>#<grain>#<periodKey>` and
  the stored-record schema validates `grain` against that same three-value
  picklist, so a year-grain breakdown record is unrepresentable.
- The rollup pipeline tops out at `applyMonthlyRollup` (hour → daily rollup →
  monthly rollup). There is no yearly rollup Lambda and nothing ever writes
  year-grain aggregates.

Overview's "Yearly" view is **not** a real year grain. It queries the already
aggregated monthly totals (`grain: "month", years: true`) server-side, then the
client folds ~12 monthly `TotalsItem`s into a year row with `groupMonthlyByYear`
(a plain sum of ~10 numeric fields). This works only because totals are small,
summable scalars.

A breakdown is a different shape: a _list of values_ per period (every status
code, every country, every device). "Rolling up" a year of breakdowns means
reading 12 monthly partitions **per dimension**, merging rows by value, and
re-deriving a top-N — not a trivial scalar sum.

## Decision

Do **not** add a Yearly grain to the Breakdowns page. Breakdowns remain at
Hourly / Daily / Monthly, sourced directly from the processor's `grains`
constant. Overview keeps its Yearly view (totals only).

## Rationale

### 1. The data is not aggregated at a year grain

The type system (`Grain` excludes `"year"`), the DynamoDB schema
(`breakdownSchema.grain` picklist), the read resolver (`resolveBreakdownLive`
only drills down month → day → hour, never up), and the write pipeline
(`applyMonthlyRollup` is the ceiling) all stop at month. There is no year-grain
record to read.

### 2. The cheap client-side trick that works for totals does not transfer

Overview's yearly view is a free client-side regroup because totals are
summable scalars already fetched as a monthly array. Breakdowns are lists keyed
by value; combining a year of them requires a per-value merge and top-N across
12 monthly reads per dimension — new aggregation logic, not a one-line regroup.

### 3. The cost/latency of the obvious implementation is not justified

The lightest path that avoids backend changes (a `years`-aware `getBreakdown`
that fans out to 12 monthly breakdowns, merges by value, and returns top-N)
multiplies the read count by up to 12 per dimension per view and adds genuinely
new merge code to test — all to serve a coarse view with limited analytical
value for a small-scale site. The benefit does not justify the added surface
area and per-view read cost.

### 4. Month is already the coarsest useful breakdown grain here

For status/country/device distributions, the month view already answers "what
does traffic look like over a long window". A year-level distribution adds
little that stepping through months does not, so the feature gap is low-impact.

## Consequences

- Breakdowns are capped at the month grain; there is no year-level distribution
  view. A user wanting annual status/country/device shares must read the
  monthly views.
- The two pages are intentionally inconsistent in their grain lists (Overview
  has Yearly, Breakdowns does not). This ADR is the record of why, so the gap is
  not mistaken for an oversight.
- If a yearly breakdown is wanted later, the preferred implementation is a
  client-side fan-out: add a `years` flag to the `getBreakdown` remote query,
  read the 12 monthly breakdowns for the year, merge rows by value with the
  existing `sumBreakdown` reducer, and return the top-N — no schema or rollup
  changes. A year-grain rollup written into DynamoDB is the heavier alternative
  and is not warranted unless read cost becomes a problem.

## Alternatives Considered

### Add a year-grain rollup + stored year breakdown records

Rejected (for now). Requires a new yearly rollup step, a new schedule, and
widening the `grains`/schema picklist to admit `"year"` — a cross-package change
to the processor for a low-value view. Reserved as the fallback only if a
client-side fan-out proves too costly.

### Client-side fan-out of 12 monthly breakdowns on demand

Rejected (for now), but documented as the preferred path if the feature is ever
requested. It needs no backend change, but it multiplies reads by ~12 per
dimension and adds new merge/top-N code and tests. Deferred until there is a
concrete need.

### Reuse Overview's `groupMonthlyByYear` for breakdowns

Rejected as infeasible. That helper sums fixed numeric fields of a single row
type; it cannot merge variable-length, value-keyed breakdown lists. The shapes
are fundamentally different.

## References

- `packages/analytics-processor/src/keys.ts` — `grains`/`Grain` (month is the
  coarsest).
- `packages/analytics-processor/src/resolveLive.ts` — `resolveBreakdownLive`
  (downward-only recursion, no year path).
- `packages/analytics-processor/src/processHour.ts` — `applyMonthlyRollup`
  (coarsest aggregation; `buildBreakdownUpdates` typed `hour | day | month`).
- `packages/analytics-dashboard/src/lib/overviewWindow.ts` —
  `groupMonthlyByYear` (the totals-only client-side regroup that has no
  breakdown equivalent).
