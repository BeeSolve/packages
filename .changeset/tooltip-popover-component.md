---
"@beesolve/analytics-dashboard": patch
---

Add a reusable graffiti-styled `Tooltip` component that renders in the browser
top layer via the Popover API, so it is never clipped by an ancestor's
`overflow` (the problem that cut off the status-code explanation inside the
scrollable breakdown table). It is anchored to its trigger with CSS anchor
positioning, keyboard-focusable and described via `aria-describedby`, uses an
SSR-safe id, and falls back to a native `title` tooltip when the Popover API is
unavailable. The status-code breakdown now uses this component.
