# How to: Get started with the HMAC signer

> Full source: https://github.com/BeeSolve/packages/tree/main/packages/hmac

## Prerequisites

- Node.js 24+ (or Bun)
- A securely stored pre-shared key

## Steps

### 1. Install

```sh
bun add @beesolve/hmac
```

```sh
npm install @beesolve/hmac
```

### 2. Sign and verify a payload

```ts
import { HmacSigner } from "@beesolve/hmac";

const hmac = new HmacSigner({ preSharedKey: process.env.HMAC_KEY! });

const data = JSON.stringify({ userId: 42 });
const signature = hmac.sign(data);

hmac.isValidSignature({ value: data, signature }); // true
```

### 3. Sign and verify a URL

`signUrl` appends an `expiresAt` timestamp and a `signature` parameter and sorts
the query so the signature is stable regardless of parameter order.
`ensureValidUrl` returns nothing on success and throws a `SignedUrlError` on
failure.

```ts
import { HmacSigner } from "@beesolve/hmac";
import { ensureValidUrl, signUrl, SignedUrlError } from "@beesolve/hmac/url";

const hmac = new HmacSigner({ preSharedKey: process.env.HMAC_KEY! });

const signed = signUrl({
  url: new URL("https://example.com/download?file=report.pdf"),
  expiresInSeconds: 300,
  hmac,
});

try {
  ensureValidUrl({ url: new URL(signed), hmac });
} catch (error) {
  if (error instanceof SignedUrlError) {
    console.log(error.code); // e.g. "EXPIRED" | "INVALID_SIGNATURE"
  }
}
```

## Common Pitfalls

- Keep the `preSharedKey` out of source control; load it from an environment variable or secret store.
- `ensureValidUrl` throws rather than returning a boolean — always wrap it in try/catch and inspect `error.code`.
- Verify the URL with the same key used to sign it, or verification fails with `INVALID_SIGNATURE`.

## See Also

- [README](../../README.md) — full API and the complete list of `SignedUrlErrorCode` values
