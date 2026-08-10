import { describe, expect, it } from "bun:test";

import * as v from "valibot";

import { dmarcReportSchema } from "../src/schema.ts";

describe("dmarcReportSchema", () => {
  it("validates a minimal report", () => {
    const report = {
      reportMetadata: {
        orgName: "example.org",
        email: "dmarc@example.org",
        reportId: "12345",
        dateRange: { begin: 1700000000, end: 1700086399 },
      },
      policyPublished: {
        domain: "example.com",
        adkim: "r",
        aspf: "r",
        p: "none",
        pct: 100,
      },
      records: [
        {
          sourceIp: "192.0.2.1",
          count: 10,
          policyEvaluated: {
            disposition: "none",
            dkim: "pass",
            spf: "pass",
          },
          identifiers: {
            headerFrom: "example.com",
          },
          authResults: {
            dkim: [{ domain: "example.com", result: "pass" }],
            spf: [{ domain: "example.com", result: "pass" }],
          },
        },
      ],
    };

    const result = v.parse(dmarcReportSchema, report);
    expect(result.reportMetadata.orgName).toBe("example.org");
    expect(result.records).toHaveLength(1);
  });

  it("validates a full report with all optional fields", () => {
    const report = {
      version: "1.0",
      reportMetadata: {
        orgName: "example.org",
        email: "dmarc@example.org",
        extraContactInfo: "https://example.org/dmarc",
        reportId: "report-99999",
        dateRange: { begin: 1700000000, end: 1700086399 },
        errors: ["Timeout fetching DNS records"],
      },
      policyPublished: {
        domain: "example.com",
        adkim: "s",
        aspf: "s",
        p: "reject",
        sp: "quarantine",
        np: "none",
        pct: 50,
        fo: "1",
      },
      records: [
        {
          sourceIp: "198.51.100.25",
          count: 3,
          policyEvaluated: {
            disposition: "quarantine",
            dkim: "fail",
            spf: "fail",
            reason: [{ type: "forwarded", comment: "Mail forwarded by example.org" }],
          },
          identifiers: {
            headerFrom: "example.com",
            envelopeFrom: "bounce.example.com",
            envelopeTo: "user@example.org",
          },
          authResults: {
            dkim: [
              { domain: "example.com", result: "fail", selector: "sel1" },
              { domain: "other.example.net", result: "pass", selector: "default" },
            ],
            spf: [{ domain: "bounce.example.com", result: "softfail", scope: "mfrom" }],
          },
        },
      ],
    };

    const result = v.parse(dmarcReportSchema, report);
    expect(result.version).toBe("1.0");
    expect(result.reportMetadata.extraContactInfo).toBe("https://example.org/dmarc");
    expect(result.reportMetadata.errors).toEqual(["Timeout fetching DNS records"]);
    expect(result.policyPublished.sp).toBe("quarantine");
    expect(result.policyPublished.np).toBe("none");
    expect(result.policyPublished.fo).toBe("1");
    expect(result.records[0]?.policyEvaluated.reason).toHaveLength(1);
    expect(result.records[0]?.identifiers.envelopeFrom).toBe("bounce.example.com");
    expect(result.records[0]?.authResults.dkim).toHaveLength(2);
  });

  it("rejects invalid disposition", () => {
    const report = {
      reportMetadata: {
        orgName: "example.org",
        email: "dmarc@example.org",
        reportId: "12345",
        dateRange: { begin: 1700000000, end: 1700086399 },
      },
      policyPublished: {
        domain: "example.com",
        adkim: "r",
        aspf: "r",
        p: "none",
        pct: 100,
      },
      records: [
        {
          sourceIp: "192.0.2.1",
          count: 1,
          policyEvaluated: {
            disposition: "invalid",
            dkim: "pass",
            spf: "pass",
          },
          identifiers: { headerFrom: "example.com" },
          authResults: { dkim: [], spf: [] },
        },
      ],
    };

    expect(() => v.parse(dmarcReportSchema, report)).toThrow();
  });

  it("rejects invalid alignment value", () => {
    const report = {
      reportMetadata: {
        orgName: "example.org",
        email: "dmarc@example.org",
        reportId: "12345",
        dateRange: { begin: 1700000000, end: 1700086399 },
      },
      policyPublished: {
        domain: "example.com",
        adkim: "x",
        aspf: "r",
        p: "none",
        pct: 100,
      },
      records: [],
    };

    expect(() => v.parse(dmarcReportSchema, report)).toThrow();
  });
});
