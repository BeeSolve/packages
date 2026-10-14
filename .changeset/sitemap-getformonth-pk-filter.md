---
"@beesolve/analytics-processor": patch
---

Fix `SitemapUrlStats.getForMonth` returning non-sitemap records.

The reverse index is keyed on `sk` (partition) + `pk` (sort), and `getForMonth`
queried it with only `sk = :month`. Other record families written to the same
table - notably the monthly totals rollup `totals#month` with `sk = "YYYY-MM"` -
share that sort key, so the query also returned them and `parseOne` threw
`Malformed stored sitemap url stat record`, surfacing as a 500 on the dashboard's
sitemap view once sitemap stats and a monthly rollup both existed for a month.

The query now constrains the index sort key with
`begins_with(pk, "sitemapurl#")` in the key condition (not a filter, since `pk`
is a primary-key attribute of the index), so only sitemap-url records are
returned.
