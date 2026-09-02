---
"@beesolve/dmarc-dashboard": patch
---

Set `paths.relative: false` so CSS and JS assets use root-relative paths (`/_app/...`) instead of relative paths (`./_app/...`). Because kit-on-lambda serves routes dynamically, relative asset paths were resolved against the current route depth (e.g. `/domains/_app/...`), returning the SPA fallback HTML instead of the stylesheet and leaving nested routes unstyled.
