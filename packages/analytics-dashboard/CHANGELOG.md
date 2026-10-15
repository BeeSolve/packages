# @beesolve/analytics-dashboard

## 0.6.0

### Minor Changes

- baee73b: Replace the sitemap two-month comparison with a hit-trends view. The page now
  has a Daily / Monthly / Yearly grain switcher plus the shared period picker
  (matching the breakdown and overview pages), a ranked per-URL hits table for the
  selected period, and a per-URL trend bar chart when a path is selected. Daily and
  monthly values come straight from the stored monthly sitemap items (per-day `dNN`
  attributes and the month total); yearly sums the twelve months in memory. Hourly
  is intentionally omitted because the sitemap store keeps no per-hour data.

## 0.5.2

### Patch Changes

- ff814b2: Rebuild against `@beesolve/analytics-processor@0.6.2` to fix a 500 on the sitemap
  view.

  The dashboard bundles the processor's `SitemapUrlStats` model, and
  `sitemap.remote.ts` calls `getForMonth`. Before the processor fix, that query
  returned the monthly totals rollup (`totals#month`) alongside the sitemap-url
  records because both share the `YYYY-MM` reverse-index sort key, and parsing
  threw `Malformed stored sitemap url stat record`. Picking up the processor patch
  scopes the query to `sitemapurl#` records.

## 0.5.1

### Patch Changes

- Updated dependencies [99d7a13]
  - @beesolve/analytics-processor@0.6.0

## 0.5.0

### Minor Changes

- ed53ed0: Add a Settings admin page and a sitemap comparison view.

  - The admin area moves from `/users` to `/settings`, combining user management (list, invite, edit) with a sitemap configuration form to view and edit the `sitemapUrl`.
  - New `/sitemap` page compares two months of per-URL hits joined by path, sorted by the later month's hits, with a nav link alongside Overview and Breakdowns.
  - `SitemapUrlStats` is wired into `event.locals.services` for the new remote queries.

### Patch Changes

- Updated dependencies [1947290]
  - @beesolve/analytics-processor@0.5.0

## 0.4.0

### Minor Changes

- bd6b5d8: Correct partial-period aggregation and surface bucket processing state.

  Processor:

  - Partial periods are now computed from exactly one grain finer, following only the current edge deeper: a partial month sums the stored day aggregates for its finished days plus the live current day (which sums hours), and a partial year sums stored month aggregates plus the live current month. A partial month no longer fans out to hourly records for its finished days, keeping the read count bounded (a year touches ~12 months + ~31 days + ~24 hours) and the request sub-second.
  - Add `classifyBucketState` / `BucketState` (`sealed` | `partial` | `pending`) so a finalized zero-traffic bucket can be told apart from one that has not been processed yet. Classification is marker-driven.

  Dashboard:

  - The overview chart distinguishes the three bucket states: final (solid), in-progress/partial (striped), and awaiting-processing/pending (a faint dashed ghost), with a legend and explanatory tooltips, so empty-because-no-data reads differently from empty-because-not-yet-calculated.

### Patch Changes

- Updated dependencies [bd6b5d8]
  - @beesolve/analytics-processor@0.4.0

## 0.3.0

### Minor Changes

- ef6f582: Dashboard UX improvements and on-the-fly partial aggregation.

  Processor:

  - Add `Config` model persisting the earliest ingested hour (`system#config` / `analytics`) so the dashboard can clamp navigation to a known start boundary. `processHour` records it on first data, and the backfill moves it earlier when older hours are ingested.
  - Add `resolveTotalsLive` / `resolveBreakdownLive`: an in-progress period (and any past period still missing its rollup marker) is computed on the fly from the grain below it, so the current day sums the hours ingested so far and the current month folds down through the current day. Sealed past periods are read from their stored rollup.
  - Add `parsePeriodKey` / `grainForPeriodKey` time helpers.

  Dashboard:

  - Overview and breakdown screens now compute the current, not-yet-rolled-up period live instead of showing it empty.
  - Period/grain state moved into URL parameters so views are bookmarkable.
  - Replace the free-text period input with a clamped picker (year/month/day/hour dropdowns) that jumps directly to any point in `[start, now]` and never navigates before the first record or into the future.
  - Time buckets are shown as human, local-timezone labels (an hour bucket reads as the clock range it spans) instead of the internal `YYYY-MM-DD-HH` key.
  - Fix unreadable selected breakdown/grain buttons.
  - Bar-chart tooltips now use the graffiti `.tooltip` component.

### Patch Changes

- Updated dependencies [ef6f582]
  - @beesolve/analytics-processor@0.3.0

## 0.2.6

### Patch Changes

- Updated dependencies [a185bd5]
  - @beesolve/cdk-constructs@0.8.0
  - @beesolve/analytics-processor@0.2.4
  - @beesolve/lambda-keep-active@2.1.12
  - @beesolve/auth-service@0.20.1
  - @beesolve/email-service@0.5.7

## 0.2.5

### Patch Changes

- b80dac0: Update dependencies. Bump `kit-on-lambda` to `^1.1.2`, which generates a Lambda
  handler that imports `@beesolve/lambda-function-url-protection/runtime`; that
  package is now declared as a dependency so the adapter's bundle resolves it.
  Also refreshes `vite` to `^8.3.4`.
- Updated dependencies [ef844f6]
- Updated dependencies [b80dac0]
  - @beesolve/auth-service@0.20.0
  - @beesolve/lambda-keep-active@2.1.11

## 0.2.4

### Patch Changes

- Updated dependencies [b34d2a6]
  - @beesolve/cdk-constructs@0.7.0
  - @beesolve/analytics-processor@0.2.3
  - @beesolve/lambda-keep-active@2.1.10
  - @beesolve/auth-service@0.19.3
  - @beesolve/email-service@0.5.6

## 0.2.3

### Patch Changes

- Updated dependencies [09efb63]
  - @beesolve/cdk-constructs@0.6.0
  - @beesolve/analytics-processor@0.2.2
  - @beesolve/lambda-keep-active@2.1.9
  - @beesolve/auth-service@0.19.2
  - @beesolve/email-service@0.5.5

## 0.2.2

### Patch Changes

- Updated dependencies [b868372]
  - @beesolve/cdk-constructs@0.5.0
  - @beesolve/analytics-processor@0.2.1
  - @beesolve/lambda-keep-active@2.1.8
  - @beesolve/auth-service@0.19.1
  - @beesolve/email-service@0.5.4

## 0.2.1

### Patch Changes

- Updated dependencies [3666a2a]
  - @beesolve/auth-service@0.19.0

## 0.2.0

### Minor Changes

- e1fff17: Add `@beesolve/analytics-dashboard` — a SvelteKit app, published as a CDK construct, for
  viewing CloudFront traffic analytics.

  The dashboard reads the `@beesolve/analytics-processor` DynamoDB table read-only (bounded
  `Query` calls, never `Scan`) and renders overview totals (hits, success, errors, bytes) across
  hourly/daily/monthly/yearly grains with rolling prev/next windows, plus per-dimension
  breakdowns (HTTP status, country, device, top paths). It runs on `kit-on-lambda` behind
  `AuthGateway` email-code authentication and uses `@drop-in/graffiti` for UI.

  `./cdk` exports the `AnalyticsDashboard` construct, which provisions the SvelteKit Lambda,
  CloudFront distribution with auth-cookie enforcement and an `/auth/*` behavior, an SES-backed
  auth-events consumer for OTP emails, and a dedicated DynamoDB table (+ reverse GSI) for the
  dashboard's own `Users`/`Setup` records (wired via `ANALYTICS_USERS_TABLE` /
  `ANALYTICS_USERS_REVERSE_INDEX`), while taking read-only access to the processor's analytics
  table through `processor.grantRead(handler)`.

### Patch Changes

- Updated dependencies [6fc65b5]
- Updated dependencies [6fc65b5]
- Updated dependencies [029b8eb]
- Updated dependencies [dfc3824]
  - @beesolve/analytics-processor@0.2.0
  - @beesolve/cdk-constructs@0.4.0
  - @beesolve/lambda-keep-active@2.1.7
  - @beesolve/auth-service@0.18.1
  - @beesolve/email-service@0.5.3
