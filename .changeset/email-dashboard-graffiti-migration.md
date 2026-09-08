---
"@beesolve/email-service-dashboard": patch
---

Migrate hand-rolled UI to graffiti design-system components across the dashboard.

- Summary and rate grids now use graffiti's Card Grid (`.layout-card`) instead of custom grid CSS.
- Toolbar and search rows on the messages and recipient pages use graffiti Cluster (`.cluster`).
- Back links on the message and recipient detail pages are now graffiti Breadcrumbs.
- The message-detail info panel and per-recipient timeline wrapper adopt graffiti Card (`.card`); the timeline component itself is unchanged.
- The overview rate cards render via the shared `SummaryCard` (graffiti Stat Card), with the SES-threshold "flagged" error tint preserved as a small non-colliding modifier.
- Data tables use graffiti's Table wrapper (`.table`), removing the custom `.table-scroll` shim from the layout.

No behavior changes — data loading, forms, dialogs, and the month picker are untouched. The layout scaffold was intentionally left hand-rolled (graffiti App Shell would regress the whole-page scroll model).
