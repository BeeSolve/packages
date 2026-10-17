---
"@beesolve/analytics-dashboard": patch
---

Fix the status-code explanation being clipped inside the breakdown table. The
graffiti `.tip` tooltip is absolutely positioned and was cut off by the table
wrapper's `overflow-x: auto`. Use a native `title` tooltip instead, which the
browser renders outside any scroll container.
