---
"@beesolve/analytics-dashboard": patch
---

Redesign the dashboard controls and navigation for clarity, and fix related
bugs:

- Overview now has a single time navigator. The redundant "Previous / Next"
  window row is removed; the period picker's own arrows and year/month/day
  selects drive the window.
- The period picker's selects are widened so the full year, month and day
  values are no longer clipped.
- Granularity and traffic tier are now distinct, labelled chip groups inside a
  controls panel, each with a hover tooltip explaining what it does. The period
  picker always sits on its own row so the panel keeps a consistent shape across
  grains.
- Breakdowns reuses the same controls panel and labelled chip groups, with
  human-readable dimension and granularity labels and a single compact caption.
- URLs shows the total count of distinct URLs, and its table no longer wraps the
  "first seen" date or the action button onto two lines.
- Watchlist opens a bucket's hits-trend in a modal dialog instead of rendering
  it above the (possibly off-screen) table, so a selection is always visible.
- Settings "Invite user" is now a primary button that opens a dialog; the
  standalone `/settings/users/invite` route is removed and the invite form
  refreshes the user list in place instead of redirecting.
- "About this data" is now an on-demand popover opened from a button on each
  page, scoped to the notes relevant to that page, instead of an always-present
  block at the bottom of every page.
- Fix a client-side crash that rendered a 500 on every page: pages imported
  runtime values (`hourKey`, `parsePeriodKey`, `tiers`, `grains`, `dimensions`)
  from the `@beesolve/analytics-processor` barrel, which dragged its AWS SDK
  dependencies into the browser bundle and threw on `node:crypto.createHash`
  during hydration. These values now come from a small client-safe
  `periodKeys` module; server code still imports from the processor.
- Fix a 400 on the hourly Breakdowns view: the status-URLs query rejected the
  four-segment hour period key (`YYYY-MM-DD-HH`); its validation now accepts it.
