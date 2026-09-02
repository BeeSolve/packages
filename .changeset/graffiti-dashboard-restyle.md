---
"@beesolve/dmarc-dashboard": minor
---

Restyle the dashboard to be graffiti-first and add IP enrichment to the report view.

- Adopt `@drop-in/graffiti` component classes and design tokens throughout: `.stat-card` for summary cards, `.tag` (driven by `--tag-color`) for verdict/status/disposition badges, `.button` variants for actions, and graffiti's global table/input/form styling. Custom CSS remains only for genuine gaps (top-bar layout, calendar widget, stats bar chart, JSON modal shell, full-row tints).
- Replace the hand-rolled JS tab control on the domain view with graffiti's native `<details name>` `.tabs.pill` component (no JavaScript, accessible by default).
- Fix the domain view layout so the summary cards and calendar sit together in the top bar and no longer overlap the tabs.
- Show the enriched source IP origin (network operator · country) in the report detail view, matching the domain view.
