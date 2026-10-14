---
"@beesolve/analytics-dashboard": patch
---

Rebuild against `@beesolve/analytics-processor@0.6.2` to fix a 500 on the sitemap
view.

The dashboard bundles the processor's `SitemapUrlStats` model, and
`sitemap.remote.ts` calls `getForMonth`. Before the processor fix, that query
returned the monthly totals rollup (`totals#month`) alongside the sitemap-url
records because both share the `YYYY-MM` reverse-index sort key, and parsing
threw `Malformed stored sitemap url stat record`. Picking up the processor patch
scopes the query to `sitemapurl#` records.
