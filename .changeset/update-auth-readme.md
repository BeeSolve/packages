---
"@beesolve/auth-service": minor
---

Add resend code endpoint (`/auth/resendCode`) with per-email throttling and configurable cooldown. Migrate `signInRequest` to use `createNewWithThrottling` with reference code generation. Map `TokenThrottledError` to HTTP 429. Add `resendCooldown` and `drainOnResend` CDK props.

Update README: add mermaid sequence diagrams, use relative URLs in client examples, document resend flow, add FAQ entries.
