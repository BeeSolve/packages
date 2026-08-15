# @beesolve/dmarc-dashboard

## 0.1.1

### Patch Changes

- bd74fdf: Add sign out button to the navigation header

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
  - @beesolve/dmarc-consumer@0.1.0

## 0.0.7

### Patch Changes

- 747300c: Run vite build in prepublishOnly to include SvelteKit output in published package, remove buildDirectory prop

## 0.0.6

### Patch Changes

- c0d250e: Build cdk.ts via bunup, pre-build authConsumer lambda, output SvelteKit to dist/build via adapter config
- @beesolve/dmarc-consumer@0.0.4

## 0.0.5

### Patch Changes

- Fix published files — include cdk.ts, src/authConsumer.ts, and build directory instead of empty dist

## 0.0.4

### Patch Changes

- Fix dependency version ranges for workspace packages (dmarc-consumer was unresolvable at ^0.0.1)

## 0.0.3

### Patch Changes

- 67f4065: Pin TypeScript to v6 for svelte-check compatibility (svelte-check does not yet support TS7 as sole version)
- @beesolve/dmarc-consumer@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [d54dca7]
- Updated dependencies [f8e3f7b]
- Updated dependencies [d54dca7]
- Updated dependencies [d674ccd]
  - @beesolve/auth-service@0.13.0
  - @beesolve/cdk-constructs@0.3.0
  - @beesolve/lambda-fetch-api@2.1.0
  - @beesolve/dmarc-consumer@0.0.2
  - @beesolve/email-service@0.3.6
