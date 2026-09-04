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
