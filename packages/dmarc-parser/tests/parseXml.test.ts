import { describe, expect, it } from "bun:test";

import { parseXml } from "../src/parseXml.ts";

describe("parseXml", () => {
  it("parses a minimal DMARC report", () => {
    const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>12345</report_id>
    <date_range>
      <begin>1700000000</begin>
      <end>1700086399</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>none</p>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.1</source_ip>
      <count>5</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>example.com</domain>
        <result>pass</result>
        <selector>sel1</selector>
      </dkim>
      <spf>
        <domain>example.com</domain>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
</feedback>`;

    const report = parseXml(xml);
    expect(report.reportMetadata.orgName).toBe("example.org");
    expect(report.reportMetadata.reportId).toBe("12345");
    expect(report.reportMetadata.dateRange.begin).toBe(1700000000);
    expect(report.policyPublished.domain).toBe("example.com");
    expect(report.policyPublished.p).toBe("none");
    expect(report.policyPublished.pct).toBe(100);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.sourceIp).toBe("192.0.2.1");
    expect(report.records[0]?.count).toBe(5);
    expect(report.records[0]?.policyEvaluated.disposition).toBe("none");
    expect(report.records[0]?.authResults.dkim).toHaveLength(1);
    expect(report.records[0]?.authResults.dkim[0]?.selector).toBe("sel1");
    expect(report.records[0]?.authResults.spf).toHaveLength(1);
  });

  it("normalizes single record to array", () => {
    const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>single-record</report_id>
    <date_range><begin>1700000000</begin><end>1700086399</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>reject</p>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>198.51.100.1</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>reject</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers><header_from>example.com</header_from></identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><result>fail</result></dkim>
      <spf><domain>example.com</domain><result>fail</result></spf>
    </auth_results>
  </record>
</feedback>`;

    const report = parseXml(xml);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.policyEvaluated.disposition).toBe("reject");
  });

  it("handles multiple dkim and spf auth results", () => {
    const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>multi-auth</report_id>
    <date_range><begin>1700000000</begin><end>1700086399</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>none</p>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.10</source_ip>
      <count>3</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers><header_from>example.com</header_from></identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><result>pass</result><selector>s1</selector></dkim>
      <dkim><domain>other.example.net</domain><result>pass</result><selector>s2</selector></dkim>
      <spf><domain>bounce.example.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

    const report = parseXml(xml);
    expect(report.records[0]?.authResults.dkim).toHaveLength(2);
    expect(report.records[0]?.authResults.spf).toHaveLength(1);
  });

  it("parses version, extra_contact_info, sp, np, fo fields", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <version>1.0</version>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>noreply@example.org</email>
    <extra_contact_info>https://example.org/dmarc</extra_contact_info>
    <report_id>full-report</report_id>
    <date_range><begin>1700000000</begin><end>1700086399</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>s</adkim>
    <aspf>s</aspf>
    <p>reject</p>
    <sp>reject</sp>
    <pct>100</pct>
    <np>reject</np>
    <fo>1</fo>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.50</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <envelope_to>example.org</envelope_to>
      <envelope_from>bounce.example.com</envelope_from>
      <header_from>example.com</header_from>
    </identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><result>pass</result><selector>sel1</selector></dkim>
      <spf><domain>bounce.example.com</domain><scope>mfrom</scope><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

    const report = parseXml(xml);
    expect(report.version).toBe("1.0");
    expect(report.reportMetadata.extraContactInfo).toBe("https://example.org/dmarc");
    expect(report.policyPublished.sp).toBe("reject");
    expect(report.policyPublished.np).toBe("reject");
    expect(report.policyPublished.fo).toBe("1");
    expect(report.records[0]?.identifiers.envelopeTo).toBe("example.org");
    expect(report.records[0]?.identifiers.envelopeFrom).toBe("bounce.example.com");
    expect(report.records[0]?.authResults.spf[0]?.scope).toBe("mfrom");
  });

  it("parses policy_evaluated reason", () => {
    const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>reason-test</report_id>
    <date_range><begin>1700000000</begin><end>1700086399</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>reject</p>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.99</source_ip>
      <count>2</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
        <reason>
          <type>forwarded</type>
          <comment>Mailing list</comment>
        </reason>
      </policy_evaluated>
    </row>
    <identifiers><header_from>example.com</header_from></identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><result>fail</result></dkim>
      <spf><domain>example.com</domain><result>fail</result></spf>
    </auth_results>
  </record>
</feedback>`;

    const report = parseXml(xml);
    expect(report.records[0]?.policyEvaluated.reason).toHaveLength(1);
    expect(report.records[0]?.policyEvaluated.reason?.[0]?.type).toBe("forwarded");
    expect(report.records[0]?.policyEvaluated.reason?.[0]?.comment).toBe("Mailing list");
  });

  it("throws on invalid XML (missing feedback)", () => {
    const xml = `<?xml version="1.0"?><not_feedback></not_feedback>`;
    expect(() => parseXml(xml)).toThrow("Invalid DMARC XML: missing <feedback> root element");
  });

  it("handles report_id as number (stringifies)", () => {
    const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>7037521486925340950</report_id>
    <date_range><begin>1700000000</begin><end>1700086399</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>none</p>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.1</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers><header_from>example.com</header_from></identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><result>pass</result></dkim>
      <spf><domain>example.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

    const report = parseXml(xml);
    expect(report.reportMetadata.reportId).toBe("7037521486925340950");
  });
});
