---
"@beesolve/hmac": patch
---

Fix `@beesolve/hmac/url` so a signer created with `new HmacSigner(...)` from `@beesolve/hmac` can be passed to `signUrl`/`ensureValidUrl`. The `url` entry point's generated declarations inlined a second `HmacSigner` class whose `private` field made it nominally incompatible with the exported one, so consumers hit a type error. `signUrl` now accepts `Pick<HmacSigner, "sign">` and `ensureValidUrl` accepts `Pick<HmacSigner, "isValidSignature">`, which any `HmacSigner` instance satisfies.
