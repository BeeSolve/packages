# @beesolve/dmarc-parser

## 0.1.3

### Patch Changes

- 58111f6: Upgrade dependencies.

  - `dmarc-parser`: bump `fast-xml-parser`, `mailparser`, and `@types/mailparser`.
  - `lambda-keep-active`: bump `@aws-sdk/client-lambda`, `@aws-sdk/client-resource-groups-tagging-api`, and the `aws-cdk-lib` dependency and peer range.
  - `lint-config`: bump `oxlint-plugin-eslint` and raise the `oxfmt`, `oxlint`, and `oxlint-tsgolint` peer ranges to match the toolchain versions used across the monorepo.

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

## 0.1.2

### Patch Changes

- 8b821bc: chore: upgrade dependencies

## 0.1.1

### Patch Changes

- f7e28a0: Update `fast-xml-parser` to ^5.11.1 and `mailparser` to ^3.9.20.

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
