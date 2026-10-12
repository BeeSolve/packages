# ADR-005: Backfill as a Standalone One-Time Script

## Status

Accepted

## Context

When analytics is first deployed, the ongoing hourly Lambda only processes hours
from the switch to v2 logging forward. All historic data exists only as legacy
v1 logs already sitting in the bucket. That history must be aggregated into the
same DynamoDB table once, after which it never needs to run again.

The historic range can span months of hours. The work is a long, embarrassingly
sequential loop: for each hour, run one Athena query and write the result. It is
not latency-sensitive, not triggered by an event, and not part of steady-state
operation. It must be resumable (a long run can be interrupted) and must never
double-count against hours the hourly Lambda has already processed near the
switch seam.

## Decision

Implement the backfill as a standalone script (`command/backfill.ts`) run by an
operator via `bun run backfill -- --from <ISO> --to <ISO> [--concurrency N]
[--rollups]`. It:

- Builds the DynamoDB and Athena clients and the model classes exactly as the
  hourly Lambda does, reading configuration from env/args.
- Iterates `hoursBetween({ from, to })` and calls the shared `processHour({
  source: "v1", … })` for each hour with bounded concurrency.
- Counts processed/skipped/failed and prints progress to stdout.
- Optionally (`--rollups`) runs the daily and monthly rollups over the range
  afterward.

It is not a Lambda and gets no CDK wiring. Resumability and exactly-once come
for free from the idempotency markers (ADR-004): an already-applied hour returns
`skipped` after a single `Get`, so re-running the script resumes instantly and
overlapping the hourly schedule is safe.

## Rationale

### 1. Shares the one write path

Calling the same `processHour` as the hourly Lambda means the backfill inherits
the schema, the atomic-`ADD` discipline, and the exactly-once marker guarantee
with zero duplicated logic. Only the Athena source differs (`v1` vs `v2`).

### 2. A one-time batch job needs no infrastructure

The work runs once. A script needs no table, queue, schedule, or deployment —
nothing to provision, nothing to tear down, nothing to pay for after it
finishes.

### 3. No timeout ceiling

A Lambda caps at 15 minutes; a months-long backfill would need chunking,
orchestration, and state just to survive the runtime. A local loop has no such
ceiling and the markers already make it resumable, so interruption is harmless.

### 4. Markers make it safe to re-run and to overlap

Because every hour is marker-guarded, the operator can stop and restart the
script, run it while the hourly schedule is live, and re-run it after a partial
failure — none of which double-counts.

## Consequences

- Backfilling history is an explicit operator action, run once from a machine
  with AWS credentials (honoring `AWS_PROFILE`), not an automated pipeline.
- The script is excluded from the package's public API and from CDK; it is an
  internal operational tool.
- There is no live progress UI or admin trigger; progress is stdout counts.
  A future admin-triggered, re-runnable reprocess would build on durable
  functions over the same `processHour`, but that is out of scope here.

## Alternatives Considered

### A scheduled or event-driven Lambda

Rejected. It would need chunking and orchestration to fit the 15-minute ceiling
and would carry standing infrastructure for a job that runs exactly once.

### A MicroVM / long-running compute task

Rejected. It adds provisioning and lifecycle management for a loop that a local
script with resumable markers already handles with no infrastructure.

### Durable functions / step orchestration

Rejected for the one-time backfill (over-engineered for a resumable loop). It
remains the right foundation for a future _admin-triggered, live-progress_
reprocess feature, which is explicitly deferred.

## References

- ADR-004 — atomic writes and idempotency markers (what makes the backfill
  resumable and exactly-once)
- `processHour` — the shared write path the backfill and hourly Lambda both call
