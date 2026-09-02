---
"@beesolve/dmarc-dashboard": patch
---

Pin `typescript` to `~6.0.3` for the dashboard. `svelte-check` does not support TypeScript 7 without the `--tsgo` flag and a dual TS6/TS7 install, which was breaking the `type-check` CI step.
