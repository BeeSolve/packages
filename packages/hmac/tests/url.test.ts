import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { HmacSigner } from "../index";
import { ensureValidUrl, signUrl, SignedUrlError, type SignedUrlErrorCode } from "../url";

describe("signUrl / ensureValidUrl", () => {
  const preSharedKey = Buffer.from("super-secret-key").toString("hex");
  const hmac = new HmacSigner({ preSharedKey });

  const now = new Date("2026-09-07T00:00:00.000Z").getTime();
  let dateNow: ReturnType<typeof spyOn>;

  function expectRejection(url: URL, code: SignedUrlErrorCode): void {
    let thrown: unknown;
    try {
      ensureValidUrl({ url, hmac });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof SignedUrlError)) {
      throw new Error(`Expected a SignedUrlError with code "${code}" but none was thrown.`);
    }

    expect(thrown.code).toBe(code);
  }

  beforeEach(() => {
    dateNow = spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    dateNow.mockRestore();
  });

  it("appends expiresAt and signature query parameters", () => {
    const signed = new URL(
      signUrl({ url: new URL("https://example.com/path"), expiresInSeconds: 60, hmac }),
    );

    expect(signed.searchParams.get("expiresAt")).toBe(String(Math.floor(now / 1000) + 60));
    expect(signed.searchParams.get("signature")).not.toBeNull();
  });

  it("accepts a freshly signed url", () => {
    const signed = signUrl({
      url: new URL("https://example.com/path?b=2&a=1"),
      expiresInSeconds: 60,
      hmac,
    });

    expect(() => ensureValidUrl({ url: new URL(signed), hmac })).not.toThrow();
  });

  it("produces a stable signature regardless of query parameter order", () => {
    const first = signUrl({
      url: new URL("https://example.com/path?a=1&b=2"),
      expiresInSeconds: 60,
      hmac,
    });
    const second = signUrl({
      url: new URL("https://example.com/path?b=2&a=1"),
      expiresInSeconds: 60,
      hmac,
    });

    const firstSignature = new URL(first).searchParams.get("signature");
    const secondSignature = new URL(second).searchParams.get("signature");

    expect(firstSignature).toBe(secondSignature);
  });

  it("rejects a url whose query parameters were tampered with", () => {
    const signed = new URL(
      signUrl({ url: new URL("https://example.com/path?a=1"), expiresInSeconds: 60, hmac }),
    );
    signed.searchParams.set("a", "2");

    expectRejection(signed, "INVALID_SIGNATURE");
  });

  it("rejects a url whose signature was tampered with", () => {
    const signed = new URL(
      signUrl({ url: new URL("https://example.com/path"), expiresInSeconds: 60, hmac }),
    );
    signed.searchParams.set("signature", "deadbeef");

    expectRejection(signed, "INVALID_SIGNATURE");
  });

  it("rejects an expired url", () => {
    const signed = signUrl({
      url: new URL("https://example.com/path"),
      expiresInSeconds: 60,
      hmac,
    });

    dateNow.mockReturnValue(now + 61_000);

    expectRejection(new URL(signed), "EXPIRED");
  });

  it("rejects a url signed with a different key", () => {
    const other = new HmacSigner({ preSharedKey: Buffer.from("another-key").toString("hex") });
    const signed = signUrl({
      url: new URL("https://example.com/path"),
      expiresInSeconds: 60,
      hmac: other,
    });

    expectRejection(new URL(signed), "INVALID_SIGNATURE");
  });

  it("rejects a url missing the signature parameter", () => {
    expectRejection(new URL("https://example.com/path?expiresAt=99999999999"), "MISSING_SIGNATURE");
  });

  it("rejects a url missing the expiresAt parameter", () => {
    expectRejection(new URL("https://example.com/path?signature=deadbeef"), "MISSING_EXPIRES_AT");
  });

  it("rejects a url with a malformed expiresAt parameter", () => {
    expectRejection(
      new URL("https://example.com/path?expiresAt=soon&signature=deadbeef"),
      "MALFORMED_EXPIRES_AT",
    );
  });
});
