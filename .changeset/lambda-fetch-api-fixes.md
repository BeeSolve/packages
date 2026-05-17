---
"@beesolve/lambda-fetch-api": patch
---

Fix `set-cookie` leaking into the flat `headers` object when cookies are present — it now only appears in `multiValueHeaders` (v1) or `cookies` (v2) as API Gateway expects. Export `MissingAwsEventHeaderError` and `MissingAwsContextHeaderError` so callers can catch them specifically.
