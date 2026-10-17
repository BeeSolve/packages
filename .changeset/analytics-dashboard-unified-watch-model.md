---
"@beesolve/analytics-dashboard": minor
---

Add URLs and Watchlist routes, cache and unique-visitor surfaces, watch
management in Settings, and data-transparency UX; remove the sitemap route.

- New `/urls` route: the URL directory (every URL served, with first-seen) and an
  admin "Add to watchlist" action per row.
- New `/watch` route (replaces `/sitemap`): a ranked table per watch bucket
  (hits, bytes transferred, cache hit/miss/error ratio, bytes saved) with a
  status badge (`active`/`stopped`), `source` (sitemap/manual), per-bucket trend
  chart, grain switcher, and period picker.
- Settings gains watchlist management: add manual patterns with `*` (split) / `+`
  (group) sugar, stop/resume, and delete (manual only). All writes go through the
  processor SDK handler and are admin-gated.
- Overview gains a cache hit/miss/error ratio panel (correct at every grain) and
  a site-wide approximate unique-visitor figure (day/month only, shown per
  period and never summed; omitted at hour/year).
- The Status breakdown gains a "URLs that errored / were redirected" view driven
  by watch metrics (class only: redirect / client+server error).
- New "About this data" disclosure and inline cues stating processing lag,
  hourly retention window, daily sitemap sync, watch-forward semantics, and
  approximate/non-summable uniques. Lag and retention render from the deployed
  config via two new env vars (`ANALYTICS_PROCESSING_LAG_HOURS`,
  `ANALYTICS_HOURLY_TTL_DAYS`).
- The top navigation highlights the active section (solid-primary pill,
  `aria-current="page"`, readable in light and dark), matching sub-routes to
  their parent section.
- BREAKING: the `/sitemap` route and the legacy top-paths breakdown view are
  removed; the breakdown dimensions are now status, country, and device.
