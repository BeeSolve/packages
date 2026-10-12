# ADR-002: Single-Table Key Schema

## Status

Accepted

## Context

The processor stores three kinds of items in one DynamoDB table: time-series
totals, per-dimension breakdowns, and exactly-once markers. The access patterns
are narrow and known in advance:

- Read a rolling window of totals for one grain (e.g. the last 24 hours, 30
  days, or 12 months), possibly crossing a day/month boundary.
- Read the full set of breakdown values for one dimension in one period (e.g.
  every country for `2026-02-14`).
- Check, atomically, whether a period has already been applied.

Volumes are tiny (single-site, single-digit requests per second), so there is
no hot-partition pressure. The schema should make each access pattern a single
bounded `Query` or `Get`, never a `Scan`, and should keep writes idempotent.

## Decision

Use a composite `pk` + `sk` table with a reverse GSI (`reverse`: GSI pk = `sk`,
GSI sk = `pk`, projection ALL), and three item layouts:

**Totals — time in the sort key, one partition per grain:**

```
pk = totals#<grain>      grain ∈ hour | day | month
sk = <timeKey>           2026-02-14-09 | 2026-02-14 | 2026-02
```

**Breakdowns — period folded into the partition key:**

```
pk = breakdown#<dimension>#<grain>#<periodKey>
sk = <value>             US | 404 | mobile | /pricing
```

**Idempotency markers — one item per applied period:**

```
pk = applied#<grain>#<periodKey>
sk = "applied"
```

Time keys are fixed-width, zero-padded, UTC, and lexicographically sortable
(`YYYY-MM-DD-HH`, `YYYY-MM-DD`, `YYYY-MM`). Hourly-grain totals, breakdowns, and
markers carry a `ttl`; day and month items do not.

## Rationale

### 1. Time-in-`sk` makes rolling windows one Query

Putting the time key in the sort key and the grain in the partition key means
all hourly buckets live in `totals#hour`, all daily buckets in `totals#day`,
and so on. A rolling window is a single `Query` with a `BETWEEN` on `sk`, even
when it crosses a day or month boundary. There is no hot partition because the
volume per grain is bounded (hourly ≤ `24 × ttlDays`).

### 2. Period-in-`pk` makes a breakdown one bare-`pk` Query

A dimension's values for one period are co-located under a single partition
key, so fetching "every country for this day" is a bare `pk =` query with no
sort-key predicate. The value lives in `sk`, so values stay unique within the
period and sort naturally.

### 3. Markers encode idempotency in the key

A marker's existence is the entire signal. Giving it a dedicated, deterministic
key per period lets the write path put it conditionally
(`attribute_not_exists(pk) AND attribute_not_exists(sk)`) inside the same
transaction as the counter updates (see ADR-004), so re-processing a period is
a no-op.

### 4. Reverse GSI mirrors dmarc-consumer

The reverse GSI gives value-first lookups should they be needed and keeps the
table shape identical to `@beesolve/dmarc-consumer`, so operational knowledge
and tooling transfer directly.

## Consequences

- Every read is a bounded `Query` or `Get`; no `Scan` is ever required.
- Hourly items expire automatically via TTL; day/month aggregates persist.
- Grain and dimension are encoded in keys, so adding a new dimension is additive
  (new `pk` prefix) and does not disturb existing items.
- Because time is in `sk` for totals but in `pk` for breakdowns, the two item
  types read differently; callers go through the model classes rather than
  constructing keys by hand.

## Alternatives Considered

### Time in the partition key for totals

Rejected. It would scatter a rolling window across many partitions and turn a
single `Query` into a fan-out of `Get`s or a `BatchGet`, with no benefit at
this volume.

### One partition per (dimension, period, value)

Rejected. It would make "all values for a period" a `Scan` or a secondary index
read instead of a single bare-`pk` query.

### A separate table per item type

Rejected. Three tables triples the operational surface and breaks the
single-transaction idempotency guarantee that depends on marker and counters
sharing one table.

## References

- ADR-004 — atomic writes and idempotency markers
- `@beesolve/dmarc-consumer` — the single-table design this mirrors
