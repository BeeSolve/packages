---
"@beesolve/dmarc-dashboard": patch
"@beesolve/email-service-dashboard": patch
---

Highlight the active section in the top navigation. Each nav link now reflects
the current route with a solid-primary pill, medium weight, and
`aria-current="page"`, matching sub-routes to their parent section (e.g. a
drill-down page keeps its section highlighted). The active state is readable in
both light and dark themes.
