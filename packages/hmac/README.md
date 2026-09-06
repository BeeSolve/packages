# HMAC signer

Simple helper for creating and validating HMAC signatures.

Installation:

```bash
bun install @beesolve/hmac
```

## Usage

```ts
import { HmacSigner } from "@beesolve/hmac";

const hmac = new HmacSigner({
  preSharedKey: "your secure key",
});

const data = JSON.stringify({ your: "data" });

const signature = hmac.sign(data);

console.log(hmac.isValidSignature({ value: data, signature })); // true
console.log(hmac.isValidSignature({ value: data, signature: "invalid signature" })); // false
```

### Signed URLs

Sign a URL with an expiry and verify it later. The query parameters are sorted before signing, so the signature is stable regardless of parameter order.

```ts
import { ensureValidUrl, signUrl, SignedUrlError } from "@beesolve/hmac/url";
import { HmacSigner } from "@beesolve/hmac";

const hmac = new HmacSigner({ preSharedKey: "your secure key" });

const signed = signUrl({
  url: new URL("https://example.com/download?file=report.pdf"),
  expiresInSeconds: 300,
  hmac,
});

try {
  ensureValidUrl({ url: new URL(signed), hmac });
  // URL is valid
} catch (error) {
  if (error instanceof SignedUrlError) {
    console.log(error.code); // e.g. "EXPIRED" | "INVALID_SIGNATURE"
  }
}
```

`ensureValidUrl` returns nothing on success and throws a `SignedUrlError` otherwise. The `code` field is one of `SignedUrlErrorCode`: `MISSING_SIGNATURE`, `MISSING_EXPIRES_AT`, `MALFORMED_EXPIRES_AT`, `EXPIRED`, or `INVALID_SIGNATURE`.
