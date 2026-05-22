import { describe, expect, test } from "bun:test";
import {
  addSetCookies,
  parseDataTokenCookie,
  parseSid,
  toDataTokenCookie,
} from "../index.ts";

describe("parseSid", () => {
  test("returns null for null input", () => {
    expect(parseSid(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseSid(undefined)).toBeNull();
  });

  test("returns null when __Host-SID is not present", () => {
    expect(parseSid("session=abc; other=xyz")).toBeNull();
  });

  test("extracts __Host-SID value", () => {
    expect(parseSid("__Host-SID=tok123")).toBe("tok123");
  });

  test("extracts __Host-SID from multi-cookie header", () => {
    expect(parseSid("foo=bar; __Host-SID=tok456; baz=qux")).toBe("tok456");
  });

  test("does not match partial cookie names", () => {
    expect(parseSid("x__Host-SID=wrong; __Host-SID=correct")).toBe("correct");
  });

  test("handles whitespace around cookie name", () => {
    expect(parseSid("foo=bar;  __Host-SID=trimmed")).toBe("trimmed");
  });
});

describe("parseDataTokenCookie", () => {
  test("returns null for null input", () => {
    expect(parseDataTokenCookie(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseDataTokenCookie(undefined)).toBeNull();
  });

  test("returns null when __Host-DataToken is not present", () => {
    expect(parseDataTokenCookie("session=abc")).toBeNull();
  });

  test("extracts __Host-DataToken value", () => {
    expect(parseDataTokenCookie("__Host-DataToken=mytoken")).toBe("mytoken");
  });

  test("extracts __Host-DataToken from multi-cookie header", () => {
    expect(
      parseDataTokenCookie("foo=bar; __Host-DataToken=dt-val; baz=qux"),
    ).toBe("dt-val");
  });
});

describe("toDataTokenCookie", () => {
  test("includes the token value", () => {
    const cookie = toDataTokenCookie("my-token");
    expect(cookie).toContain("my-token");
  });

  test("sets __Host-DataToken name", () => {
    const cookie = toDataTokenCookie("x");
    expect(cookie).toMatch(/^__Host-DataToken=/);
  });

  test("is HttpOnly", () => {
    expect(toDataTokenCookie("x")).toContain("HttpOnly");
  });

  test("defaults Max-Age to 900", () => {
    expect(toDataTokenCookie("x")).toContain("Max-Age=900");
  });

  test("accepts a custom maxAge", () => {
    expect(toDataTokenCookie("x", 300)).toContain("Max-Age=300");
  });

  test("uses SameSite=Strict", () => {
    expect(toDataTokenCookie("x")).toContain("SameSite=Strict");
  });

  test("is Secure", () => {
    expect(toDataTokenCookie("x")).toContain("Secure");
  });

  test("scoped to Path=/", () => {
    expect(toDataTokenCookie("x")).toContain("Path=/");
  });
});

describe("addSetCookies", () => {
  test("appends __Host-SID cookie when maxAge > 0", () => {
    const headers = new Headers();
    addSetCookies({ headers, cookies: [{ sid: "abc", maxAge: 3600 }] });
    const setCookies = headers.getSetCookie();
    const sidCookie = setCookies.find((c) => c.startsWith("__Host-SID=abc"));
    expect(sidCookie).toBeDefined();
    expect(sidCookie).toContain("Max-Age=3600");
    expect(sidCookie).toContain("HttpOnly");
    expect(sidCookie).toContain("SameSite=Strict");
    expect(sidCookie).toContain("Secure");
    expect(sidCookie).toContain("Path=/");
  });

  test("appends aSID=1 when maxAge > 0", () => {
    const headers = new Headers();
    addSetCookies({ headers, cookies: [{ sid: "abc", maxAge: 3600 }] });
    const setCookies = headers.getSetCookie();
    const aSid = setCookies.find((c) => c.startsWith("aSID=1"));
    expect(aSid).toBeDefined();
  });

  test("appends aSID=0 when maxAge <= 0 (cookie deletion)", () => {
    const headers = new Headers();
    addSetCookies({ headers, cookies: [{ sid: "abc", maxAge: -1 }] });
    const setCookies = headers.getSetCookie();
    const aSid = setCookies.find((c) => c.startsWith("aSID=0"));
    expect(aSid).toBeDefined();
  });

  test("sets Max-Age=-1 on __Host-SID for deletion", () => {
    const headers = new Headers();
    addSetCookies({ headers, cookies: [{ sid: "del", maxAge: -1 }] });
    const setCookies = headers.getSetCookie();
    const sidCookie = setCookies.find((c) => c.startsWith("__Host-SID=del"));
    expect(sidCookie).toContain("Max-Age=-1");
  });

  test("appends two Set-Cookie entries per cookie entry", () => {
    const headers = new Headers();
    addSetCookies({ headers, cookies: [{ sid: "s1", maxAge: 100 }] });
    expect(headers.getSetCookie()).toHaveLength(2);
  });

  test("handles multiple cookie entries", () => {
    const headers = new Headers();
    addSetCookies({
      headers,
      cookies: [
        { sid: "old", maxAge: -1 },
        { sid: "new", maxAge: 3600 },
      ],
    });
    expect(headers.getSetCookie()).toHaveLength(4);
  });

  test("returns the same headers object", () => {
    const headers = new Headers();
    const result = addSetCookies({
      headers,
      cookies: [{ sid: "abc", maxAge: 100 }],
    });
    expect(result).toBe(headers);
  });

  test("handles empty cookies array without error", () => {
    const headers = new Headers();
    addSetCookies({ headers, cookies: [] });
    expect(headers.getSetCookie()).toHaveLength(0);
  });
});
