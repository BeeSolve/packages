---
"@beesolve/analytics-processor": patch
---

Process active watch entries in the hourly cron. The hourly handler now lists
active watch config and runs `processWatchHour` for each entry after the
site-wide totals, so watch bucket stats (hits, bytes, cache) are populated every
hour instead of never. Each entry is processed independently and is marker-guarded,
and a failure on one entry is logged without aborting the rest of the run.
