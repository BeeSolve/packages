---
"@beesolve/dmarc-dashboard": patch
---

Fix the theme toggle and use graffiti's native dialog for the raw-JSON viewer.

- Initialise the theme override and system scheme synchronously and re-read the
  OS preference on click, so the first toggle persists the correct value.
- Map the toggle icons explicitly: light → sun, dark → moon.
- Render the raw-JSON report viewer with graffiti's native `<dialog>`
  (`showModal`/`close`) for a real modal backdrop, Escape-to-close and focus
  trapping.
