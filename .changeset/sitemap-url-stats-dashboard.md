---
"@beesolve/analytics-dashboard": minor
---

Add a Settings admin page and a sitemap comparison view.

- The admin area moves from `/users` to `/settings`, combining user management (list, invite, edit) with a sitemap configuration form to view and edit the `sitemapUrl`.
- New `/sitemap` page compares two months of per-URL hits joined by path, sorted by the later month's hits, with a nav link alongside Overview and Breakdowns.
- `SitemapUrlStats` is wired into `event.locals.services` for the new remote queries.
