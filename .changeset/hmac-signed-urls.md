---
"@beesolve/hmac": minor
---

Add `signUrl` and `ensureValidUrl` (exported from `@beesolve/hmac/url`) for HMAC-signed URLs with expiry. `signUrl` appends an `expiresAt` timestamp and a `signature` query parameter derived from a stable, query-parameter-sorted URL. `ensureValidUrl` recomputes the signature over the same stable form and throws a `SignedUrlError` (with a string `code` of type `SignedUrlErrorCode`: `MISSING_SIGNATURE`, `MISSING_EXPIRES_AT`, `MALFORMED_EXPIRES_AT`, `EXPIRED`, or `INVALID_SIGNATURE`) explaining why verification failed.
