---
"@beesolve/analytics-dashboard": patch
---

Reconcile sitemap watch entries immediately on save, and explain breakdown
values in the UI.

- Saving the sitemap URL now also triggers `syncSitemapNow`, so `source="sitemap"`
  watch entries are created right away instead of waiting for the next daily
  rollup. The watch list is refreshed so the new entries appear immediately.
- The status-code breakdown now shows a tooltip explaining each HTTP status,
  including the CloudFront pseudo-status `0` (no response recorded — typically a
  viewer disconnect).
- The country breakdown now shows the full country name (via `Intl.DisplayNames`)
  alongside the ISO code, falling back to the raw value for unknown codes.
