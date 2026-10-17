---
"@beesolve/analytics-dashboard": patch
---

Make the watch pattern suffix slash-optional and show it in the list.

- `addWatch` now accepts `/blog*` (split) and `/assets+` (group) in addition to
  `/blog/*` and `/assets/+` — the slash before the `*`/`+` suffix is optional.
- The watchlist table in settings now renders each entry's full pattern
  (e.g. `/blog*`, `/assets+`) instead of only the bare matcher, so the
  split/group suffix is visible alongside the mode column.
