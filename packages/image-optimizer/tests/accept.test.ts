import { describe, expect, it } from "bun:test";

import { negotiateFormat } from "../src/accept";

describe("negotiateFormat", () => {
  it("selects webp for Chrome", () => {
    expect(
      negotiateFormat("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"),
    ).toBe("webp");
  });

  it("selects webp for Firefox", () => {
    expect(
      negotiateFormat("image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5"),
    ).toBe("webp");
  });

  it("selects webp for Safari", () => {
    expect(
      negotiateFormat("image/webp,image/avif,image/jxl,image/heic,image/*;q=0.8,*/*;q=0.5"),
    ).toBe("webp");
  });

  it("selects the original for curl", () => {
    expect(negotiateFormat("*/*")).toBe("original");
  });

  it("selects the original for a generic image range", () => {
    expect(negotiateFormat("image/*")).toBe("original");
    expect(negotiateFormat("image/png,image/jpeg")).toBe("original");
  });

  it("selects the original when webp has quality zero", () => {
    expect(negotiateFormat("image/webp;q=0,image/png")).toBe("original");
    expect(negotiateFormat("image/webp; q=0.0")).toBe("original");
  });

  it("selects webp for a positive quality", () => {
    expect(negotiateFormat("image/png,image/webp;q=0.1")).toBe("webp");
    expect(negotiateFormat("image/webp;q=1")).toBe("webp");
  });

  it("ignores case and whitespace", () => {
    expect(negotiateFormat(" Image/WebP ; Q=0.8 ")).toBe("webp");
  });

  it("selects the original for a missing or empty header", () => {
    expect(negotiateFormat(undefined)).toBe("original");
    expect(negotiateFormat("")).toBe("original");
  });

  it("selects the original for a malformed header", () => {
    expect(negotiateFormat(";;;,,,")).toBe("original");
    expect(negotiateFormat("image/webp;q=abc")).toBe("original");
    expect(negotiateFormat("image/webp;q=")).toBe("original");
    expect(negotiateFormat("image/webp;q=2.00000")).toBe("original");
    expect(negotiateFormat("garbage")).toBe("original");
  });

  it("does not treat similar media types as webp", () => {
    expect(negotiateFormat("image/webpx")).toBe("original");
    expect(negotiateFormat("application/image/webp")).toBe("original");
  });
});
