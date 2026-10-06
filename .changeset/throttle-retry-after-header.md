---
"@beesolve/auth-service": patch
---

Send a `Retry-After` header on `429` throttle responses.

When `/auth/signInRequest` or `/auth/resendCode` is throttled, the `429` response now includes a `Retry-After` header with the number of seconds until a new code can be requested (sourced from `TokenThrottledError.retryAfterSeconds`). Clients can read it to show an accurate countdown instead of guessing the cooldown.
