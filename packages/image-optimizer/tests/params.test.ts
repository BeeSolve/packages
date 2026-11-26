import { describe, expect, it } from "bun:test";

import { parseParams } from "../src/params";

describe("parseParams", () => {
  it("applies the defaults for an empty query", () => {
    expect(parseParams("")).toEqual({
      dpr: 1,
      fit: "clip",
      q: 75,
      rot: 0,
      placeholder: false,
    });
  });

  it("parses every parameter", () => {
    expect(
      parseParams("w=400&h=300&dpr=2&fit=max&q=60&fm=jpg&rot=90&flip=hv&placeholder=1"),
    ).toEqual({
      w: 400,
      h: 300,
      dpr: 2,
      fit: "max",
      q: 60,
      fm: "jpg",
      rot: 90,
      flip: "hv",
      placeholder: true,
    });
  });

  it("accepts the limits", () => {
    expect(parseParams("w=8192&h=1&dpr=3&q=100")).toMatchObject({ w: 8192, h: 1, dpr: 3, q: 100 });
    expect(parseParams("q=1")).toMatchObject({ q: 1 });
  });

  it("normalizes the query before parsing", () => {
    expect(parseParams("W=0300&FIT=MAX&utm_source=x")).toMatchObject({ w: 300, fit: "max" });
  });

  it("rejects values above the limits with a readable message", () => {
    expect(() => parseParams("w=8193")).toThrow("w");
    expect(() => parseParams("h=9000")).toThrow("h");
    expect(() => parseParams("dpr=4")).toThrow("dpr");
    expect(() => parseParams("q=101")).toThrow("q");
  });

  it("rejects values below the limits", () => {
    expect(() => parseParams("w=0")).toThrow("w");
    expect(() => parseParams("dpr=0.5")).toThrow("dpr");
    expect(() => parseParams("q=0")).toThrow("q");
  });

  it("rejects invalid and unsupported values", () => {
    expect(() => parseParams("w=abc")).toThrow();
    expect(() => parseParams("fit=crop")).toThrow("crop");
    expect(() => parseParams("fm=avif")).toThrow("fm");
    expect(() => parseParams("rot=45")).toThrow("rot");
    expect(() => parseParams("flip=x")).toThrow("flip");
    expect(() => parseParams("placeholder=yes")).toThrow("placeholder");
    expect(() => parseParams("blur=10")).toThrow("blur");
  });

  it("lists the offending parameter in an invalid parameters error", () => {
    expect(() => parseParams("w=9999")).toThrow("Invalid image parameters");
  });
});
