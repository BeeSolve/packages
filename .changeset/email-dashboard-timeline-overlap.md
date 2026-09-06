---
"@beesolve/email-service-dashboard": patch
---

Fix overlapping content in the per-recipient timeline on the message detail page. Each timeline entry now uses a grid layout with the status badge in its own column and the timestamp and detail text stacked vertically beside it, so they no longer collide when the timestamp wraps to multiple lines at narrow widths.
