# ADR-004: Atomic Writes and Exactly-Once via Idempotency Markers

## Status

Accepted

## Context

Each closed hour must be aggregated into DynamoDB exactly once, even though the
same hour can be presented to the write path more than once:

- The hourly schedule can overlap or retry.
- The one-time backfill can be re-run or can overlap the hourly schedule for a
  seam hour.
- A future SQS-driven reprocess could redeliver.

The counters (`hits`, `success`, `errors`, `bytesSent`, …) are additive, so a
naive read-modify-write would both race under concurrency and double-count under
re-processing. The hourly detail fields (`p50TimeTaken`, `p95TimeTaken`,
`cacheHitRatio`, `uniqueIpCount`) are **not** additive — percentiles and ratios
cannot be summed on a re-run.

## Decision

Write every period through atomic updates guarded by a per-period marker, all in
one transaction:

- Additive counters use `UpdateCommand` with `ADD`; metadata and non-additive
  hourly detail use `SET`.
- The per-period marker (`applied#<grain>#<periodKey>`) is written with a
  conditional put (`attribute_not_exists(pk) AND attribute_not_exists(sk)`) in
  the **same** `TransactWriteCommand` as the totals and breakdown updates. If the
  marker already exists the whole transaction is cancelled and the write is
  skipped — so re-processing never double-counts.
- `processHour` additionally pre-checks the marker and returns early (no Athena
  query, no writes) when the hour is already applied, so the common
  already-done case costs a single `Get`.

DynamoDB transactions cap at 100 items. Breakdowns per hour are bounded (status
~dozens, device ≤ 4, country ≤ ~200, path ≤ topN + 1), so a period can exceed
100 items. When it does, the write is chunked: the marker + totals go in the
first transaction, and the remaining breakdown updates follow in subsequent
writes. Because the marker is set in the first chunk, any retry of the follow-up
chunks is itself guarded — a re-run short-circuits on the marker pre-check.

## Rationale

### 1. `ADD` removes the race

Atomic `ADD` lets DynamoDB apply increments server-side, so concurrent writers
to the same counter compose correctly without a read-modify-write cycle.

### 2. Conditional marker in the same transaction gives exactly-once

Bundling the conditional marker put with the counter updates makes "has this
period been applied?" and "apply this period" a single atomic decision. The
marker cannot exist without its counters having been applied, and the counters
cannot be applied twice because the second attempt fails the condition.

### 3. `SET` for non-additive detail

Percentiles and ratios are overwritten, not summed. Using `SET` for them (and
for metadata like `grain`/`timeKey`) keeps a re-applied hour's detail correct
rather than accumulating nonsense.

### 4. Chunking preserves the guarantee past 100 items

Writing the marker in the first chunk means the marker pre-check guards every
subsequent chunk. A crash between chunks leaves the marker set and the remaining
breakdowns to be completed on a guarded re-run, which the pre-check turns into a
safe continuation rather than a double-count.

## Consequences

- Hours, days, and months are each applied exactly once; the hourly schedule and
  the backfill can overlap and re-run freely.
- Rollups reuse the same marker + `ADD` discipline against the coarser grains, so
  daily and monthly aggregates are equally safe.
- The >100-item path is slightly weaker than a single transaction between chunks
  (a crash can leave a partially written period), but the marker makes the
  guarded re-run converge; it never double-counts.
- Every write goes through the model classes' transact-item builders so the
  `ADD`/`SET`/conditional expressions live in one place.

## Alternatives Considered

### Read-modify-write counters

Rejected. Races under concurrency and double-counts under re-processing — exactly
what the schedule/backfill overlap would trigger.

### A single large transaction with no chunking

Rejected. It would break the moment a period exceeds the 100-item transaction
cap, which the path bounds but does not forbid.

### A separate idempotency store (e.g. a lock table)

Rejected. It would move the marker out of the counter transaction and lose the
single-atomic-decision property; the marker must share the transaction with the
counters.

## References

- ADR-002 — single-table key schema (marker and counter key layout)
- `@beesolve/dmarc-consumer` `Domains.upsert` / `ProcessingStats.increment` — the
  atomic-`ADD` pattern this follows
