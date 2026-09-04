import { describe, expect, it } from "bun:test";

import { HmacSigner } from "../index";

describe("HmacSigner", () => {
  const preSharedKey = Buffer.from("super-secret-key").toString("hex");

  it("produces a deterministic signature for the same value", () => {
    const hmac = new HmacSigner({ preSharedKey });
    const value = JSON.stringify({ your: "data" });

    expect(hmac.sign(value)).toBe(hmac.sign(value));
  });

  it("validates a signature it produced", () => {
    const hmac = new HmacSigner({ preSharedKey });
    const value = JSON.stringify({ your: "data" });
    const signature = hmac.sign(value);

    expect(hmac.isValidSignature({ value, signature })).toBe(true);
  });

  it("rejects an incorrect signature", () => {
    const hmac = new HmacSigner({ preSharedKey });
    const value = JSON.stringify({ your: "data" });

    expect(hmac.isValidSignature({ value, signature: "invalid signature" })).toBe(false);
  });

  it("produces different signatures for different keys", () => {
    const first = new HmacSigner({ preSharedKey });
    const second = new HmacSigner({
      preSharedKey: Buffer.from("another-key").toString("hex"),
    });
    const value = "payload";

    expect(first.sign(value)).not.toBe(second.sign(value));
  });

  it("honours a custom algorithm", () => {
    const sha256 = new HmacSigner({ preSharedKey });
    const sha512 = new HmacSigner({ preSharedKey, algorithm: "SHA512" });
    const value = "payload";

    expect(sha512.sign(value)).not.toBe(sha256.sign(value));
    expect(sha512.isValidSignature({ value, signature: sha512.sign(value) })).toBe(true);
  });
});
