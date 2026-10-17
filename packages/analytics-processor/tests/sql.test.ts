import { describe, expect, it } from "bun:test";

import { canonicalUriExpr, escapeSqlString, toCount } from "../src/sql.ts";

describe("canonicalUriExpr", () => {
  it("builds a trailing-slash collapse CASE over the given column", () => {
    expect(canonicalUriExpr("cs_uri_stem")).toBe(
      "CASE WHEN length(cs_uri_stem) > 1 AND substr(cs_uri_stem, -1) = '/' THEN substr(cs_uri_stem, 1, length(cs_uri_stem) - 1) ELSE cs_uri_stem END",
    );
  });
});

describe("escapeSqlString", () => {
  it("doubles single quotes", () => {
    expect(escapeSqlString("/o'brien")).toBe("/o''brien");
    expect(escapeSqlString("/plain")).toBe("/plain");
  });
});

describe("toCount", () => {
  it("parses numeric cells and treats empty/undefined/non-numeric as zero", () => {
    expect(toCount("42")).toBe(42);
    expect(toCount("")).toBe(0);
    expect(toCount(undefined)).toBe(0);
    expect(toCount("abc")).toBe(0);
  });
});
