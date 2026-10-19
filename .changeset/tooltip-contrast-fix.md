---
"@beesolve/analytics-dashboard": patch
---

Fix low-contrast tooltip text. The Tooltip surface used `--fg-1` (10% opacity
foreground), making the explanation text nearly invisible in both light and dark
mode. Use the full-strength `--fg` so the text meets the surface contrast.
