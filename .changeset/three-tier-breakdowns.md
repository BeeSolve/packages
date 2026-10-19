---
"@beesolve/analytics-processor": minor
"@beesolve/analytics-dashboard": minor
---

Add three-tier totals and breakdowns: `all` (every request, unchanged), `real`
(successful HTML page views — `sc_content_type LIKE 'text/html%' AND sc_status
BETWEEN 200 AND 299`), and `watch` (the active sitemap URL set). Each tier is
stored in its own namespace (`totals#<tier>#…`, `breakdown#<tier>#…`) with its
own applied-marker namespace, so the tiers are computed, rolled up, and
backfilled independently and never collide. The `all` tier's keys are
byte-identical to before.

Processor:

- `requiredRecordFields` and `columnMap` now include `sc_content_type` so the
  `real` tier can filter by content type. Consumers configuring CloudFront log
  delivery from `requiredRecordFields` must redeploy to deliver the new column;
  the `real` tier populates from that point forward (no historical backfill).
- `buildHourlyQuery`/`runHourlyAthenaQuery` accept an optional `extraPredicate`;
  `processHour`, `applyDailyRollup`, and `applyMonthlyRollup` accept `tier` and
  `force`; the hourly/daily/monthly handlers now also compute the `real` and
  `watch` tiers.
- The backfill CLI gains `--tier <all|real|watch>` (repeatable) and `--force`
  (reprocess ignoring the applied marker) for one-off tier recomputes.
- The resolvers (`resolveTotalsLive`, `resolveBreakdownLive`,
  `classifyBucketState`) accept a `tier`, defaulting to `all`.
- New `tierPredicates` module and `Tier`/`tiers`/`tierSegment` exports.
- The v1→v2 compaction column map now carries `sc-content-type` (correctness for
  future compactions).

Dashboard:

- The Overview and Breakdowns pages gain a traffic-tier selector (All / Real /
  Sitemap) wired through the URL, threading `tier` into `getOverview` and
  `getBreakdown`.
