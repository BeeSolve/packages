---
"@beesolve/dmarc-dashboard": patch
---

Bump `kit-on-lambda` to `^0.7.0`, which serves static assets from a REST S3
origin with Origin Access Control instead of an S3 website origin. Missing
assets now return a clean 404 with the correct Content-Type instead of an HTML
fallback, so a version skew or partial upload no longer manifests as
"Importing a module script failed" / silent styling breakage. The assets
bucket also becomes fully private.
