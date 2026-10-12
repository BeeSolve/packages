---
"@beesolve/analytics-processor": minor
---

Add `@beesolve/analytics-processor` — CloudFront analytics aggregation and storage.

The package turns CloudFront standard-logs (queried via Athena) into a bounded,
fast-to-read DynamoDB single-table design of hourly totals, per-dimension breakdowns
(status, country, device, path), and daily/monthly rollups. Writes use atomic `ADD`
counter updates guarded by per-period `applied#...` idempotency markers written
conditionally in the same transaction, so processing is exactly-once and safe to re-run.

Public API (`.`): typed schemas (`totalsSchema`/`TotalsItem`, `breakdownSchema`/`BreakdownItem`,
`appliedMarkerSchema`/`AppliedMarker`, `grains`/`Grain`, `dimensions`/`Dimension`),
time/window helpers (`hourKey`, `dayKey`, `monthKey`, `maxWindowFor`, `windowKeys`,
`shiftAnchor`, `hoursBetween`), model classes (`Totals`, `Breakdowns`, `AppliedMarkers`,
`IpInfoCache` + `lookupIpInfo`), pure helpers (`buildHourlyQuery`, `classifyDevice`,
`sumTotals`, `sumBreakdown`, `topNWithOther`), and `processHour` (+ `applyDailyRollup`/`applyMonthlyRollup`).

`./cdk` exports the `AnalyticsProcessor` construct, which provisions the table + reverse
GSI, three scheduled Lambdas (hourly processor + daily/monthly rollups) with least-privilege
Athena/Glue/S3 access, and a read-only `grantRead(handler)` helper for a dashboard. A
one-time standalone backfill script (`bun run backfill`) walks historic v1 data through
the same write path.
