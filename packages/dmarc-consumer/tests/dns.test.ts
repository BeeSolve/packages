import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { DomainDns } from "../dnsRecord.ts";

const resolveTxtMock = mock<(hostname: string) => Promise<Array<Array<string>>>>();

void mock.module("node:dns/promises", () => ({
  resolveTxt: resolveTxtMock,
}));

const { isDnsStale, resolveDomainDns } = await import("../dns.ts");

function nodeError(code: string): Error {
  const error: Error & { code?: string } = new Error(code);
  error.code = code;
  return error;
}

describe("isDnsStale", () => {
  it("is stale when dns is undefined", () => {
    expect(isDnsStale({ dns: undefined, ttlMs: 1_000 })).toBe(true);
  });

  it("is stale when fetchedAt is missing", () => {
    const dns: Partial<DomainDns> = {};
    expect(isDnsStale({ dns, ttlMs: 1_000 })).toBe(true);
  });

  it("is fresh when fetchedAt is now and ttl is large", () => {
    const dns: DomainDns = { fetchedAt: new Date().toISOString() };
    expect(isDnsStale({ dns, ttlMs: 60_000 })).toBe(false);
  });

  it("is stale when fetchedAt is older than ttl", () => {
    const dns: DomainDns = { fetchedAt: new Date(Date.now() - 10_000).toISOString() };
    expect(isDnsStale({ dns, ttlMs: 1_000 })).toBe(true);
  });
});

describe("resolveDomainDns", () => {
  beforeEach(() => {
    resolveTxtMock.mockReset();
  });

  it("maps per-lookup results and isolates failures", async () => {
    resolveTxtMock.mockImplementation(async (hostname) => {
      if (hostname === "example.com") {
        return [["v=spf1 include:_spf.google.com ", "-all"]];
      }
      if (hostname === "_dmarc.example.com") {
        return [["v=DMARC1; p=reject; rua=mailto:agg@example.com"]];
      }
      if (hostname === "good._domainkey.example.com") {
        return [["v=DKIM1; k=rsa; p=MIGf"]];
      }
      if (hostname === "missing._domainkey.example.com") {
        throw nodeError("ENODATA");
      }
      throw nodeError("ENOTFOUND");
    });

    const dns = await resolveDomainDns({
      domain: "example.com",
      dkimSelectors: ["good", "missing"],
    });

    expect(dns.fetchedAt).toBeTruthy();
    expect(dns.error).toBeUndefined();

    expect(dns.spf?.valid).toBe(true);
    expect(dns.spf?.all).toBe("-all");

    expect(dns.dmarc?.valid).toBe(true);
    expect(dns.dmarc?.policy).toBe("reject");

    expect(dns.dkimSelectors).toEqual([
      { selector: "good", found: true, raw: "v=DKIM1; k=rsa; p=MIGf" },
      { selector: "missing", found: false },
    ]);
  });

  it("sets a top-level error when the apex does not resolve", async () => {
    resolveTxtMock.mockRejectedValue(nodeError("NXDOMAIN"));

    const dns = await resolveDomainDns({
      domain: "does-not-exist.example",
      dkimSelectors: ["sel"],
    });

    expect(dns.error).toBeTruthy();
    expect(dns.spf).toBeUndefined();
    expect(dns.dmarc).toBeUndefined();
    expect(dns.dkimSelectors).toBeUndefined();
    expect(dns.fetchedAt).toBeTruthy();
  });

  it("parses spf and dmarc on the success path with fetchedAt set", async () => {
    resolveTxtMock.mockImplementation(async (hostname) => {
      if (hostname === "example.com") {
        return [["v=spf1 -all"]];
      }
      if (hostname === "_dmarc.example.com") {
        return [["v=DMARC1; p=quarantine"]];
      }
      throw nodeError("ENODATA");
    });

    const dns = await resolveDomainDns({
      domain: "example.com",
      dkimSelectors: [],
    });

    expect(dns.error).toBeUndefined();
    expect(dns.fetchedAt).toBeTruthy();
    expect(dns.spf?.valid).toBe(true);
    expect(dns.dmarc?.valid).toBe(true);
    expect(dns.dkimSelectors).toEqual([]);
  });
});
