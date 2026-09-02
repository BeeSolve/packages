---
"@beesolve/dmarc-dashboard": minor
---

Add a light/dark theme toggle and polish the dashboard UI.

- Add a two-state color-scheme toggle in the header (single sun/moon icon).
  It flips to the opposite of the resolved scheme, stores an explicit
  `light`/`dark` override, and reverts to the system default when the target
  matches the OS preference. A no-flash inline script applies any stored
  override before first paint.
- Fix summary cards on the domain overview and domain detail pages so they lay
  out in a responsive row instead of stacking full-width.
- Switch the domain detail tabs from the pill variant to plain underline tabs
  and render the per-tab counts as compact tags.
- Colour the Authorized Senders alignment column (green "Aligned" vs neutral).
- Pin visited link colour so content links no longer show the browser default.
- Use a graffiti callout for the IP-refresh notice and a ghost button for the
  refresh action.
- Vertically centre the header "Sign out" button with the rest of the nav.
