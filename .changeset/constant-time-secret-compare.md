---
"@beesolve/action-tokens": patch
"@beesolve/hmac": patch
---

Use constant-time comparison (`crypto.timingSafeEqual`) when verifying secrets to remove a timing side-channel.

- `@beesolve/hmac`: `HmacSigner.isValidSignature` now compares the decoded signature bytes in constant time instead of using `===`. This also hardens `ensureValidUrl` (signed URL verification), which routes through it.
- `@beesolve/action-tokens`: `ActionTokens.use` now compares the token value in constant time instead of using `===`.

No API changes; behaviour is identical for matching and non-matching inputs.
