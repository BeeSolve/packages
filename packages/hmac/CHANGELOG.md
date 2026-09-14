# @beesolve/hmac

## 0.3.1

### Patch Changes

- 05c4043: Fix `@beesolve/hmac/url` so a signer created with `new HmacSigner(...)` from `@beesolve/hmac` can be passed to `signUrl`/`ensureValidUrl`. The `url` entry point's generated declarations inlined a second `HmacSigner` class whose `private` field made it nominally incompatible with the exported one, so consumers hit a type error. `signUrl` now accepts `Pick<HmacSigner, "sign">` and `ensureValidUrl` accepts `Pick<HmacSigner, "isValidSignature">`, which any `HmacSigner` instance satisfies.

## 0.3.0

### Minor Changes

- f02c1a4: Add `signUrl` and `ensureValidUrl` (exported from `@beesolve/hmac/url`) for HMAC-signed URLs with expiry. `signUrl` appends an `expiresAt` timestamp and a `signature` query parameter derived from a stable, query-parameter-sorted URL. `ensureValidUrl` recomputes the signature over the same stable form and throws a `SignedUrlError` (with a string `code` of type `SignedUrlErrorCode`: `MISSING_SIGNATURE`, `MISSING_EXPIRES_AT`, `MALFORMED_EXPIRES_AT`, `EXPIRED`, or `INVALID_SIGNATURE`) explaining why verification failed.

## 0.2.0

### Minor Changes

- 99fa173: Add `@beesolve/hmac` — HMAC signer for creating and validating HMAC signatures, moved into the monorepo from its standalone repository.
