---
"@beesolve/analytics-processor": minor
"@beesolve/analytics-dashboard": minor
---

Dashboard UX improvements and on-the-fly partial aggregation.

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
