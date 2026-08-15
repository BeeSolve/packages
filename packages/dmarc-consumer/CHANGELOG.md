# @beesolve/dmarc-consumer

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
