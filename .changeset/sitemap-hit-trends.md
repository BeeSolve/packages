---
"@beesolve/analytics-dashboard": minor
---

Replace the sitemap two-month comparison with a hit-trends view. The page now
has a Daily / Monthly / Yearly grain switcher plus the shared period picker
(matching the breakdown and overview pages), a ranked per-URL hits table for the
selected period, and a per-URL trend bar chart when a path is selected. Daily and
monthly values come straight from the stored monthly sitemap items (per-day `dNN`
attributes and the month total); yearly sums the twelve months in memory. Hourly
is intentionally omitted because the sitemap store keeps no per-hour data.
