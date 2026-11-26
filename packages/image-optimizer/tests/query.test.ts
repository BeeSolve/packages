import { describe, expect, it } from "bun:test";

import { canonicalizeQuery, isRotation, supportedQueryKeys } from "../src/query";

function canonical(query: string): string {
  const result = canonicalizeQuery(query);
  if ("error" in result) throw new Error(result.error);
  return result.query;
}

function errorOf(query: string): string {
  const result = canonicalizeQuery(query);
  if ("query" in result) throw new Error(`Expected an error, got "${result.query}"`);
  return result.error;
}

describe("canonicalizeQuery", () => {
  it("returns an empty string for an empty query", () => {
    expect(canonical("")).toBe("");
    expect(canonical("?")).toBe("");
    expect(canonical("&&")).toBe("");
  });

  it("drops values equal to their default", () => {
    expect(canonical("fit=clip&w=300")).toBe(canonical("w=300"));
    expect(canonical("fit=clip&dpr=1&rot=0&q=75&placeholder=0")).toBe("");
  });

  it("keeps values that differ from the default", () => {
    expect(canonical("fit=max&dpr=2&rot=90&q=80&placeholder=1")).toBe(
      "dpr=2&fit=max&placeholder=1&q=80&rot=90",
    );
  });

  it("is insensitive to parameter order", () => {
    expect(canonical("h=2&w=1")).toBe("h=2&w=1");
    expect(canonical("w=1&h=2")).toBe(canonical("h=2&w=1"));
  });

  it("keeps the last value of duplicated keys", () => {
    expect(canonical("w=100&w=200")).toBe("w=200");
    expect(canonical("w=100&W=200")).toBe("w=200");
  });

  it("lowercases keys and enum values", () => {
    expect(canonical("W=300&FIT=MAX&FM=WebP&Flip=HV")).toBe("fit=max&flip=hv&fm=webp&w=300");
  });

  it("normalizes numeric values", () => {
    expect(canonical("w=0300")).toBe("w=300");
    expect(canonical("w=300.0")).toBe("w=300");
    expect(canonical("dpr=2.0")).toBe("dpr=2");
    expect(canonical("dpr=1.50")).toBe("dpr=1.5");
    expect(canonical("q=075")).toBe("");
  });

  it("decodes percent-encoded values", () => {
    expect(canonical("w=3%30%30")).toBe("w=300");
  });

  it("drops empty values and valueless keys", () => {
    expect(canonical("w=&h&fit=max")).toBe("fit=max");
  });

  it("drops unknown keys such as tracking parameters", () => {
    expect(canonical("utm_source=newsletter&w=300&fbclid=abc")).toBe("w=300");
  });

  it("is idempotent", () => {
    const first = canonical("H=200&w=0300&fit=CLIP&utm=1&dpr=2.0&fm=jpg");
    expect(canonical(first)).toBe(first);
  });

  it("returns an error for unsupported imgix parameters", () => {
    expect(errorOf("crop=top")).toContain("crop");
    expect(errorOf("w=300&blur=20")).toContain("blur");
    expect(errorOf("CROP=faces")).toContain("crop");
    expect(errorOf("crop=")).toContain("crop");
  });

  it("returns an error for unsupported fit values", () => {
    for (const fit of ["crop", "min", "fill", "fillmax", "clamp", "facearea"]) {
      expect(errorOf(`fit=${fit}`)).toContain(fit);
    }
    expect(errorOf("fit=CROP")).toContain("crop");
  });

  it("returns an error for invalid values", () => {
    expect(errorOf("fit=stretch")).toContain("fit");
    expect(errorOf("fm=avif")).toContain("fm");
    expect(errorOf("flip=x")).toContain("flip");
    expect(errorOf("w=abc")).toContain("w");
    expect(errorOf("w=-5")).toContain("w");
    expect(errorOf("w=1e3")).toContain("w");
    expect(errorOf("w=300.5")).toContain("integer");
    expect(errorOf("rot=45")).toContain("rot");
    expect(errorOf("rot=360")).toContain("rot");
    expect(errorOf("placeholder=yes")).toContain("placeholder");
    expect(errorOf("w=%E0%A4%A")).toContain("percent-encoding");
    expect(errorOf("w=12345678901")).toContain("w");
  });

  it("accepts every supported key", () => {
    const all = canonical("w=100&h=100&dpr=2&fit=scale&q=60&fm=png&rot=180&flip=v&placeholder=1");
    for (const key of supportedQueryKeys) {
      expect(all).toContain(`${key}=`);
    }
  });
});

describe("isRotation", () => {
  it("accepts quarter turns only", () => {
    expect([0, 90, 180, 270].every(isRotation)).toBe(true);
    expect([45, 360, -90, 1.5, Number.NaN].some(isRotation)).toBe(false);
  });
});
