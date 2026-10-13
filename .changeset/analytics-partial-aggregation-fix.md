---
"@beesolve/analytics-processor": minor
"@beesolve/analytics-dashboard": minor
---

Correct partial-period aggregation and surface bucket processing state.

Processor:

- Partial periods are now computed from exactly one grain finer, following only the current edge deeper: a partial month sums the stored day aggregates for its finished days plus the live current day (which sums hours), and a partial year sums stored month aggregates plus the live current month. A partial month no longer fans out to hourly records for its finished days, keeping the read count bounded (a year touches ~12 months + ~31 days + ~24 hours) and the request sub-second.
- Add `classifyBucketState` / `BucketState` (`sealed` | `partial` | `pending`) so a finalized zero-traffic bucket can be told apart from one that has not been processed yet. Classification is marker-driven.

Dashboard:

- The overview chart distinguishes the three bucket states: final (solid), in-progress/partial (striped), and awaiting-processing/pending (a faint dashed ghost), with a legend and explanatory tooltips, so empty-because-no-data reads differently from empty-because-not-yet-calculated.
