---
"@beesolve/dmarc-dashboard": patch
---

Migrate hand-rolled UI to graffiti design-system components across the dashboard.

- Summary-card grids (overview, domain detail, stats) use graffiti's Card Grid (`.layout-card`) instead of custom grid CSS; the stats bar chart is unchanged.
- Back links on the domain and report detail pages are now graffiti Breadcrumbs, and the domain "Load more" link uses `.button.ghost` to match the rest of the UI.
- The report metadata panel and domain setup-health panel adopt graffiti Card (`.card`), keeping their small toolbar head rows layered on top.
- Data tables use graffiti's Table wrapper (`.table`), removing the custom `.table-scroll` shim from the layout; row-status tints (`.row-warn` / `.row-fail`) are preserved.

Also fixes breadcrumb rendering: the breadcrumb list now aligns flush with the page heading (the default `<ul>` indent is reset), the domain-page actions menu is vertically aligned, and the report-detail "View Raw JSON" action moves to the top-right corner to match the domain page.

No behavior changes — data loading, forms, dialogs, and the calendar are untouched. The layout scaffold was intentionally left hand-rolled (graffiti App Shell would regress the whole-page scroll model).
