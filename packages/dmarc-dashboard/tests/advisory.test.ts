import { describe, expect, it } from "bun:test";

import type { DomainDns } from "@beesolve/dmarc-consumer/dns-record";

import { buildAdvisory } from "../src/lib/server/advisory.ts";
import type { DomainAggregate } from "../src/lib/server/aggregate.ts";

function makeAggregate(overrides: Partial<DomainAggregate> = {}): DomainAggregate {
  return {
    totalMessages: 100,
    totalPass: 100,
    totalFail: 0,
    uniqueIps: 1,
    reportCount: 1,
    spfPassRate: 100,
    dkimPassRate: 100,
    spoofingAttempts: 0,
    sourceIpBreakdown: [],
    senderAlignment: [],
    ...overrides,
  };
}

function makeDns(overrides: Partial<DomainDns> = {}): DomainDns {
  return {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    dmarc: { raw: "v=DMARC1; p=reject", policy: "reject", valid: true },
    spf: { raw: "v=spf1 -all", all: "-all", lookupCount: 0, valid: true },
    dkimSelectors: [],
    ...overrides,
  };
}

function ids(findings: ReturnType<typeof buildAdvisory>): Array<string> {
  return findings.map((finding) => finding.id);
}

function byId(findings: ReturnType<typeof buildAdvisory>, id: string) {
  return findings.find((finding) => finding.id === id);
}

describe("buildAdvisory", () => {
  it("returns no findings for a healthy, well-configured domain", () => {
    const findings = buildAdvisory({ dns: makeDns(), aggregate: makeAggregate() });
    expect(findings).toEqual([]);
  });

  describe("policy-missing", () => {
    it("flags critical when no valid DMARC record exists", () => {
      const dns = makeDns({ dmarc: undefined });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "policy-missing")?.severity).toBe("critical");
    });

    it("flags critical when the DMARC record is invalid", () => {
      const dns = makeDns({ dmarc: { raw: "not-dmarc", valid: false } });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "policy-missing")?.severity).toBe("critical");
    });

    it("does not flag when a valid DMARC record exists", () => {
      const findings = buildAdvisory({ dns: makeDns(), aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("policy-missing");
    });
  });

  describe("policy-none", () => {
    it("is a warning when p=none and authentication is failing", () => {
      const dns = makeDns({ dmarc: { raw: "v=DMARC1; p=none", policy: "none", valid: true } });
      const findings = buildAdvisory({
        dns,
        aggregate: makeAggregate({ spfPassRate: 40, dkimPassRate: 30 }),
      });
      expect(byId(findings, "policy-none")?.severity).toBe("warning");
    });

    it("is info when p=none but authentication is healthy", () => {
      const dns = makeDns({ dmarc: { raw: "v=DMARC1; p=none", policy: "none", valid: true } });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "policy-none")?.severity).toBe("info");
    });

    it("does not flag when the policy is enforcing", () => {
      const findings = buildAdvisory({ dns: makeDns(), aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("policy-none");
    });
  });

  describe("pct-partial", () => {
    it("flags info when pct < 100", () => {
      const dns = makeDns({
        dmarc: { raw: "v=DMARC1; p=reject; pct=50", policy: "reject", pct: 50, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "pct-partial")?.severity).toBe("info");
    });

    it("does not flag when pct is 100", () => {
      const dns = makeDns({
        dmarc: { raw: "v=DMARC1; p=reject; pct=100", policy: "reject", pct: 100, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("pct-partial");
    });
  });

  describe("spf-missing", () => {
    it("flags warning when no valid SPF record exists", () => {
      const dns = makeDns({ spf: undefined });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "spf-missing")?.severity).toBe("warning");
    });
  });

  describe("spf-softfail", () => {
    it("flags critical for +all", () => {
      const dns = makeDns({
        spf: { raw: "v=spf1 +all", all: "+all", lookupCount: 0, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "spf-softfail")?.severity).toBe("critical");
    });

    it("flags info for ~all", () => {
      const dns = makeDns({
        spf: { raw: "v=spf1 ~all", all: "~all", lookupCount: 0, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "spf-softfail")?.severity).toBe("info");
    });

    it("flags info for ?all", () => {
      const dns = makeDns({
        spf: { raw: "v=spf1 ?all", all: "?all", lookupCount: 0, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "spf-softfail")?.severity).toBe("info");
    });

    it("does not flag for -all", () => {
      const findings = buildAdvisory({ dns: makeDns(), aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("spf-softfail");
    });
  });

  describe("spf-lookups", () => {
    it("flags warning when lookups exceed 10", () => {
      const dns = makeDns({
        spf: { raw: "v=spf1 -all", all: "-all", lookupCount: 12, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "spf-lookups")?.severity).toBe("warning");
    });

    it("does not flag when lookups are within the limit", () => {
      const dns = makeDns({
        spf: { raw: "v=spf1 -all", all: "-all", lookupCount: 10, valid: true },
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("spf-lookups");
    });
  });

  describe("dkim-selector-missing", () => {
    it("flags warning for a signing selector that is not published", () => {
      const dns = makeDns({
        dkimSelectors: [
          { selector: "sel1", found: true, raw: "k=rsa" },
          { selector: "sel2", found: false },
        ],
      });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(byId(findings, "dkim-selector-missing:sel2")?.severity).toBe("warning");
      expect(ids(findings)).not.toContain("dkim-selector-missing:sel1");
    });
  });

  describe("spoofing-blocked", () => {
    it("adds a positive ok finding when spoofing was blocked", () => {
      const findings = buildAdvisory({
        dns: makeDns(),
        aggregate: makeAggregate({ spoofingAttempts: 42 }),
      });
      expect(byId(findings, "spoofing-blocked")?.severity).toBe("ok");
    });

    it("does not add it when there were no spoofing attempts", () => {
      const findings = buildAdvisory({ dns: makeDns(), aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("spoofing-blocked");
    });
  });

  describe("dns-unavailable", () => {
    it("degrades gracefully when dns is undefined", () => {
      const findings = buildAdvisory({ dns: undefined, aggregate: makeAggregate() });
      expect(byId(findings, "dns-unavailable")?.severity).toBe("info");
      // report-derived findings still evaluated
      expect(ids(findings)).toContain("policy-missing");
    });

    it("notes dns-unavailable when the record carries an error", () => {
      const dns = makeDns({ error: "ENOTFOUND" });
      const findings = buildAdvisory({ dns, aggregate: makeAggregate() });
      expect(ids(findings)).toContain("dns-unavailable");
    });

    it("does not note dns-unavailable when DNS was read cleanly", () => {
      const findings = buildAdvisory({ dns: makeDns(), aggregate: makeAggregate() });
      expect(ids(findings)).not.toContain("dns-unavailable");
    });
  });
});
