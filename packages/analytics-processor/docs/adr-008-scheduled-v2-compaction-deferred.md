# ADR-008: Scheduled v2 Compaction (Deferred)

## Status

Proposed — **deferred, not built**. This ADR records the discovery and design so
a future implementation does not have to redo the analysis.

## Context

A reusable, on-demand `compact` command (`command/compact.ts`) was added to
convert a legacy v1 LazySimpleSerDe CloudFront log table into a v2-shaped
Parquet table: Parquet, partitioned by `year/month/day/hour`, one file per
partition (via `bucketed_by = ARRAY['c_ip'], bucket_count = 1`), with v1 column
names renamed to the v2 schema. See `command/compact.ts` and the design note
`.session-notes/2026-10-14-compact-command-design.md`.

The motivation was a real incident: querying the v1 table cost ~$350 in a single
backfill. The root cause was **S3 GET request count**, not bytes scanned —
Athena/Trino issues one-or-more GET per file, and the v1 table was ~93K tiny
gzip files, so every hour query fanned out across the whole table (~813.6M GETs
measured). Compaction into hour-partitioned Parquet with one file per partition
collapsed that to ~13 files per hour (~7000x fewer GETs), and renaming the
columns to the v2 shape let us delete the processor's entire v1 code path.

The open question this ADR settles: should we also run a **scheduled** job that
compacts the live **v2** table on an ongoing basis?

### What we considered building

A scheduled Lambda (plus EventBridge rule, IAM, and a second Glue table at a
`compact/v2/` prefix) that periodically rewrites recent v2 partitions into
one-file-per-hour Parquet, leaving the raw v2 delivery prefix untouched,
idempotent per period. It would reuse the SQL builders from `command/compact.ts`
(reading from v2 — already normalized columns, already partitioned — so the
SELECT is a straight projection with the same `bucket_count = 1` single-file
trick).

### Why the win is marginal

- **The v2 table does not have the v1 disease.** CloudFront log delivery writes
  v2 directly as Parquet, already hour-partitioned, at roughly 11 files per hour
  (~264/day). That is ~350x smaller than the v1 fan-out that caused the
  incident.
- **The live hourly processor only ever queries the newest hour** (~11 files)
  and never re-scans history. So scheduled v2 compaction gives the hourly cron
  **zero** benefit.
- The only beneficiary is **ad-hoc or re-backfill queries over historical v2
  data**. Even uncompacted, a full-year v2 re-scan touches ~96K files ≈ a few
  dollars in GETs — real but an order of magnitude away from the $350 class of
  problem.
- A separate compacted-v2 table introduces a **drift/correctness burden**:
  something has to ensure callers query the right table, and the compacted copy
  must stay consistent with the live table.

### Cadence analysis (the part worth preserving)

Cadence changes not just the run cost but _what the job is for_:

- **Daily** (~365 runs/yr): tidies a single day that nobody is going to re-scan
  tomorrow. Highest standing-infra cost for the least benefit. Rejected.
- **Weekly** (~52 runs/yr): cheaper, but still mostly tidying recent data the
  hourly cron does not benefit from. Marginal.
- **Monthly** (~12 runs/yr): the job stops being "tidy yesterday" and becomes
  "roll up last month's v2 into one-file-per-hour, permanently." Each run
  coalesces ~8K files (≈264/day × 30) into ~720 (one per hour), after which any
  historical re-scan of that month is as cheap as possible. This is a genuine
  archival-compaction story and aligns with the existing monthly rollup
  schedule.

If this is ever built, **monthly is the cadence to pick**, and it should
piggyback on the existing monthly rollup rather than add a whole new function:
add a compaction step to the monthly rollup Lambda (which already runs for "last
month") instead of standing up a separate Lambda + schedule + IAM. The raw v2
prefix stays untouched; the step is idempotent per month (drop + rewrite that
month's partitions in the `compact/v2/` prefix).

## Decision

**Do not build scheduled v2 compaction now.** The $350 problem is fully solved
by the one-time v1 compaction plus deleting the v1 code path. Keep the
on-demand `compact` command for the rare case of re-backfilling historical data.

Revisit **only if** historical v2 re-scan cost becomes material (e.g. frequent
full-history re-backfills, or v2 history growing large). When revisited:

1. Implement as an added step in the **monthly** rollup Lambda, not a new
   function.
2. Target a `compact/v2/` prefix; never mutate the raw v2 delivery prefix.
3. Make it idempotent per month (drop + rewrite that month's partitions).
4. Prefer fixing it further upstream first: fewer, larger files at **write**
   time (CloudFront / Firehose delivery buffering) is the cheaper lever than any
   downstream compaction job.

## Consequences

- No new always-on infrastructure; no second Glue table to keep consistent.
- Historical v2 re-scans remain slightly more expensive than they could be, but
  that cost is already small (single-digit dollars at full-year scale) and only
  paid on rare ad-hoc/backfill runs.
- The reusable `compact` command remains available for on-demand use.
- A future implementer has the cadence trade-off and the "piggyback on monthly
  rollup" shape pre-decided here, so no rediscovery is needed.
