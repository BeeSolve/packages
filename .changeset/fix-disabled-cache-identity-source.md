---
"@beesolve/auth-service": patch
---

Fix `identitySource` for `authorizerCache: "disabled"` — use empty array instead of `undefined` so CDK doesn't fall back to the default `$request.header.Authorization`, which caused API Gateway to return 401 without invoking the authorizer Lambda.
