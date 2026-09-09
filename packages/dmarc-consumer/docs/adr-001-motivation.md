# ADR-001: Why This Package Exists

## Status

Accepted

## Context

The DMARC monitoring stack is split into composable packages. [`@beesolve/dmarc-parser`](../../dmarc-parser) turns gzipped report XML into typed objects, and [`@beesolve/dmarc-reports`](../../dmarc-reports) receives report emails via SES and emits a `DmarcReportParsed` event to EventBridge for each one. Neither of those packages persists anything — the reports package is deliberately fire-and-forget so it can be deployed per-account with no knowledge of where the data ends up.

That leaves a gap: something has to durably store parsed reports, maintain the per-domain aggregate counters the dashboard reads, and own the DynamoDB schema. This work has distinct concerns from both parsing (pure, AWS-free) and receiving (SES/S3 ingestion): it needs a queue with a dead-letter queue for ret/durability, atomic counter updates, a query layer with pagination, and a table + reverse GSI that the dashboard and other readers depend on.

Folding persistence into `dmarc-reports` would couple the fire-and-forget collector to a database it shouldn't know about, and would break the single-account collector / dashboard-account consumer split (the collector can run cross-account, emitting to the dashboard account's bus). Folding it into the dashboard would put the ingestion pipeline, table ownership, and consumer Lambda inside a SvelteKit app — mixing an event-driven backend with a request/response frontend and forcing the two to deploy and scale together.

## Decision

Provide `@beesolve/dmarc-consumer` as the standalone package that owns DMARC report **persistence and aggregation**. It:

- Subscribes to `DmarcReportParsed` EventBridge events via SQS (with a DLQ).
- Persists each parsed report to DynamoDB and atomically maintains per-domain aggregate counters (`totalMessages`, `totalPass`, `totalFail`).
- Owns the single-table schema (report items, domain aggregates) and the reverse GSI used to list domains.
- Exposes typed data-access classes (`Reports`, `Domains`) and a CDK construct (`DmarcConsumer`) with `grantRead`/`grantReadWrite` for downstream readers such as the dashboard.

The package is the persistence boundary of the stack: everything that reads DMARC data goes through its models and its table, and everything that writes DMARC data goes through its consumer.

## Rationale

### 1. Ownership follows the data

The consumer owns the table, the schema, the query layer, and the aggregation logic. Readers (the dashboard, admin tooling, backfill/DNS/alert workers) consume its exports rather than reimplementing DynamoDB access, so the schema has exactly one owner.

### 2. Clean separation from the collector

Keeping persistence out of `dmarc-reports` preserves that package's fire-and-forget, cross-account-capable design. The collector emits an event and is done; the consumer decides how and where to store it. New consumers (alerting, analytics) can subscribe to the same event with zero changes to the collector.

### 3. Event-driven backend, not a frontend concern

Ingestion is asynchronous, bursty, and retryable — a natural fit for SQS + Lambda with a DLQ and partial-batch failure handling. Keeping it separate from the dashboard lets the two deploy, scale, and fail independently.

### 4. Durable and idempotent by construction

Atomic `ADD` counter updates avoid read-modify-write races on the aggregates, batched writes respect DynamoDB limits, and SQS partial-batch failures route retries through the DLQ. Domain-aggregate failures are logged without blocking report persistence.

## Consequences

- The consumer is the single owner of the DMARC DynamoDB schema; schema changes ripple to every reader, so additive/backward-compatible changes are preferred (see `adr-003-dns-cache-on-domain-record.md`).
- Downstream packages depend on the consumer's exports and CDK grants rather than touching the table directly.
- Deploying DMARC monitoring requires this package alongside the parser and collector — it is not usable on its own, but that is inherent to its role.
- Later additions (IP enrichment cache, DNS cache, job-run tracking) live here because they extend the same table and consumer — captured in the numbered ADRs that follow.

## Alternatives Considered

### Persist inside `@beesolve/dmarc-reports`

Rejected. It would couple the fire-and-forget collector to a database, break the single-account-collector / dashboard-account-consumer split, and force every collector deployment to own a table it doesn't read.

### Persist inside `@beesolve/dmarc-dashboard`

Rejected. It would put an event-driven ingestion pipeline, queue, and table ownership inside a SvelteKit request/response app, coupling their deployment and scaling and blurring backend/frontend responsibilities.

### No aggregation — compute totals on read

Rejected. Recomputing per-domain totals by scanning reports on every dashboard load does not scale and defeats the point of a fast overview. Maintaining aggregates with atomic counters at write time keeps reads cheap and bounded.

## References

- [`@beesolve/dmarc-reports`](../../dmarc-reports) — SES → S3 → EventBridge collector (emits `DmarcReportParsed`)
- [`@beesolve/dmarc-parser`](../../dmarc-parser) — pure report parsing
- `adr-003-dns-cache-on-domain-record.md` — backward-compatible extension of the domain record
