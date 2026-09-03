---
"@beesolve/dmarc-dashboard": patch
---

Make the dashboard mobile friendly.

- Wrap all data tables (domain overview, source IPs, authorized senders,
  reports, report records, processing stats, users) in a shared
  `.table-scroll` container so wide tables scroll horizontally within their
  own bounds instead of forcing the whole page to scroll sideways on narrow
  screens.
- Make the header nav responsive: below 40rem it wraps onto multiple rows and
  tightens spacing so the brand, links, and actions stay reachable.
- Add a viewport guard (`min-width: 0` on the main container) so no child can
  force the page wider than the viewport.
