import { describe, expect, it } from "bun:test";

import { parseDmarcRecord, parseSpfRecord } from "../dnsRecord.ts";

describe("parseSpfRecord", () => {
  it("parses a hard-fail record with -all", () => {
    const result = parseSpfRecord("v=spf1 include:_spf.google.com -all");

    expect(result.valid).toBe(true);
    expect(result.all).toBe("-all");
    expect(result.lookupCount).toBe(1);
  });

  it("parses a soft-fail record with ~all", () => {
    const result = parseSpfRecord("v=spf1 include:mailgun.org mx ~all");

    expect(result.valid).toBe(true);
    expect(result.all).toBe("~all");
    expect(result.lookupCount).toBe(2);
  });

  it("counts more than 10 DNS-lookup mechanisms", () => {
    const result = parseSpfRecord(
      "v=spf1 include:a.com include:b.com include:c.com include:d.com include:e.com include:f.com include:g.com include:h.com include:i.com include:j.com include:k.com -all",
    );

    expect(result.valid).toBe(true);
    expect(result.lookupCount).toBe(11);
    expect(result.all).toBe("-all");
  });

  it("counts a, mx, ptr, exists and redirect mechanisms", () => {
    const result = parseSpfRecord(
      "v=spf1 a mx ptr exists:%{i}.example.com redirect=_spf.example.com",
    );

    expect(result.valid).toBe(true);
    expect(result.lookupCount).toBe(5);
  });

  it("marks non-spf1 strings as invalid but keeps raw", () => {
    const result = parseSpfRecord("not an spf record");

    expect(result.valid).toBe(false);
    expect(result.raw).toBe("not an spf record");
    expect(result.all).toBeUndefined();
  });
});

describe("parseDmarcRecord", () => {
  it("parses p=reject; pct=100; adkim=s", () => {
    const result = parseDmarcRecord(
      "v=DMARC1; p=reject; sp=quarantine; pct=100; adkim=s; aspf=r; rua=mailto:agg@example.com,mailto:agg2@example.com",
    );

    expect(result.valid).toBe(true);
    expect(result.policy).toBe("reject");
    expect(result.subdomainPolicy).toBe("quarantine");
    expect(result.pct).toBe(100);
    expect(result.adkim).toBe("s");
    expect(result.aspf).toBe("r");
    expect(result.rua).toEqual(["agg@example.com", "agg2@example.com"]);
  });

  it("parses a p=none record", () => {
    const result = parseDmarcRecord("v=DMARC1; p=none; rua=mailto:reports@example.com");

    expect(result.valid).toBe(true);
    expect(result.policy).toBe("none");
    expect(result.rua).toEqual(["reports@example.com"]);
    expect(result.pct).toBeUndefined();
  });

  it("marks malformed strings as invalid but keeps raw", () => {
    const result = parseDmarcRecord("v=spf1 -all");

    expect(result.valid).toBe(false);
    expect(result.raw).toBe("v=spf1 -all");
    expect(result.policy).toBeUndefined();
  });
});
