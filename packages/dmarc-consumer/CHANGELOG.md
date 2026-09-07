# @beesolve/dmarc-consumer

## 0.2.2

### Patch Changes

- Updated dependencies [f02c1a4]
  - @beesolve/helpers@0.2.0
  - @beesolve/cdk-constructs@0.3.1
  - @beesolve/sqs-handler@0.2.5

## 0.2.1

### Patch Changes

- 5148324: Fix the IP-details backfill and improve the dashboard.

  - `dmarc-consumer`: the first backfill on a fresh table always failed with
    "already running" because `startRun` assigned into a nested `domains` map that
    was never seeded. The map is now seeded idempotently before the guarded
    transaction. `BackfillSdk.start` no longer treats every
    `TransactionCanceledException` as already-running — it inspects the
    cancellation reasons and only reports already-running on a genuine
    conditional-check failure, rethrowing real errors. A `started` run older than
    the worker's max lifetime is now treated as re-runnable so a crashed or
    timed-out worker no longer pins a domain forever. Also removed the unused
    `Backfill.putRunHistory` and the unused `BackfillSdk.complete`/`fail` methods,
    extracted a shared `toDynamoClient`, and dropped unused ipinfo response fields.
  - `dmarc-dashboard`: the backfill button is renamed to "Refresh IP details" with
    clarifying help text, restyled to match the app, and disabled while its request
    is in flight. The domain detail page groups Source IPs, Authorized senders, and
    Reports into tabs and uses a stable card grid. The date calendar now navigates
    months correctly, disables future days, and clearly distinguishes today, the
    selected day, and disabled days.

## 0.2.0

### Minor Changes

- 46113a7: Add optional source IP enrichment (ASN + country) via ipinfo.io Lite, plus a
  per-domain backfill job for historical data.

  - `dmarc-consumer` gains an `IpInfoCache` (`./ip-info` export) that caches per-IP
    ASN/country lookups as `ipinfo#<ip>` items in the existing table. Caching is
    presence-only: an IP is looked up once and reused thereafter, with no TTL or
    staleness refresh (`fetchedAt` is stored as metadata only). The consumer enriches
    source IPs at ingestion time when `IPINFO_API_KEY` is configured, and skips
    enrichment entirely when it is not. The consumer Lambda has read+write on the table
    and accepts an optional `ipInfoApiKey` CDK prop.
  - `dmarc-consumer` also gains a per-domain backfill feature: a `BackfillSdk` (`./sdk`
    export) and an SQS-driven worker Lambda that paginates existing reports for a domain
    (never scans), collects unique source IPs, and populates the enrichment cache for
    historical data. Backfill state (a single latest-per-domain config record plus
    per-run history) is tracked in the table, writes are transactional, and the
    `DmarcConsumer` construct exposes `grantBackfill(lambda)` to let a caller (the
    dashboard) enqueue runs.
  - `dmarc-dashboard` domain detail now shows an Origin (ASN · country) column, a
    plain-language Verdict per source IP (legitimate / forwarded / suspicious / likely
    spoofing), a "Spoofing Blocked" summary card, surfaced `headerFrom` / raw SPF+DKIM
    results / policy-override reasons, an Authorized Senders alignment panel, and a
    scope note clarifying that aggregate reports are domain-level only. The domains list
    gains a per-domain "Run backfill" button, gated by backfill status.

## 0.1.2

### Patch Changes

- 211293f: Fix `grantReadWrite` to inject correct env var names (`DMARC_TABLE_NAME`, `DMARC_REVERSE_INDEX`) expected by the dashboard

## 0.1.1

### Patch Changes

- 132cb8b: Add `grantReadWrite` method to `DmarcConsumer` CDK construct for granting Lambda handlers read/write access to the consumer table

## 0.1.0

### Minor Changes

- a08175b: feat: dashboard UX, processing stats & daily aggregation (Phase 6)

  **dmarc-parser**

  - Export `dmarcRecordSchema` for downstream validation

  **dmarc-reports**

  - Handler no longer throws on auth/spam/virus failures — emits `DmarcProcessingStats` EventBridge events instead
  - Removed DynamoDB dependency from handler (stats persisted by consumer)
  - Export `statsDetailType`, `statsCounters`, `StatsCounter`, `dmarcProcessingStatsEventSchema`

  **dmarc-consumer**

  - Subscribe to `DmarcProcessingStats` events and persist daily counters via `ProcessingStats` class
  - Add `ProcessingStats` entity (pk=`stats#daily`, sk=date, atomic ADD counters)
  - Add `getReport()` method (O(1) GetItem with full composite key)
  - Add `getDailyAggregate()` and `getDailyAggregateAllDomains()` for future alert emails
  - Add `ReportNotFoundError` for explicit not-found handling
  - Export `./processing-stats` subpath

  **dmarc-dashboard**

  - Visual overhaul: theme, nav, summary cards, status badges
  - Source IP analysis table on domain detail page
  - Report drill-down page with full per-record auth results
  - Calendar date filter with server-side time-range queries
  - Processing stats admin page (last 30 days, daily breakdown)
  - Aggregate helper for computing per-domain metrics

### Patch Changes

- Updated dependencies [a08175b]
  - @beesolve/dmarc-parser@0.1.0
  - @beesolve/dmarc-reports@0.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [c0d250e]
  - @beesolve/dmarc-reports@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [67f4065]
  - @beesolve/dmarc-reports@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [d54dca7]
  - @beesolve/cdk-constructs@0.3.0
  - @beesolve/dmarc-reports@0.0.2
