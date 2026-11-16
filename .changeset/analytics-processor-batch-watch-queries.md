---
"@beesolve/analytics-processor": minor
---

The hourly processor now computes all watch entries for an hour with one Athena query instead of one query per entry. Athena bills a 10 MB minimum per query and hourly partitions are tiny, so a site with ~60 watched URLs dropped from ~66 to ~4 billed queries per hour (about 94% less Athena cost). Results are identical to the per-entry queries. Adds `processWatchHourBatch` and `buildWatchHourBatchQuery`; `processWatchHour` is unchanged.
