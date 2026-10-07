---
"@beesolve/lambda-function-url-protection": minor
---

Make origin-token enforcement opt-in by environment. `protectFetch` and `protectHandler` now enforce the token only when `ORIGIN_TOKEN` is set to a non-empty value; when it is unset or empty they pass the request through to the wrapped handler. Once enforcement is engaged it is still fail-closed (a missing or mismatched `x-origin-token` header is rejected with a 403). This lets a single handler be wrapped unconditionally and deployed behind both a token-protected Function URL origin and a non-token origin (such as an API Gateway origin). Supersedes the previous "reject when `ORIGIN_TOKEN` is unset" behavior (see ADR-002).
