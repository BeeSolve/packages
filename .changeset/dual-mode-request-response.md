---
"@beesolve/auth-service": minor
---

Add dual-mode request/response support. Handlers now accept both `application/json` and `application/x-www-form-urlencoded` request bodies via the new `getBody` helper. Sign-in and sign-out handlers return a JSON response when the client sends `Accept: application/json`, falling back to a 303 redirect otherwise. Fix redirect status from 301 to 303 (correct semantics for POST→redirect).
