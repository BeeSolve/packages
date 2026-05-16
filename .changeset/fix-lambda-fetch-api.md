---
"@beesolve/lambda-fetch-api": patch
---

fix content-type regex to correctly anchor `application/json` and related types; previously `application/jsonx` would be incorrectly treated as text
