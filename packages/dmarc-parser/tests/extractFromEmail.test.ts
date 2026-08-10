import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";

import { extractFromEmail } from "../src/extractFromEmail.ts";

const sampleXml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>mime-test</report_id>
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

describe("extractFromEmail", () => {
  it("extracts gzipped XML attachment from MIME email", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const base64Content = gzipped.toString("base64");

    const mimeEmail = [
      "From: dmarc@example.org",
      "To: dmarc-reports@example.com",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="boundary123"',
      "",
      "--boundary123",
      "Content-Type: text/plain",
      "",
      "Please find the DMARC report attached.",
      "--boundary123",
      "Content-Type: application/gzip",
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="example.org!example.com!1700000000!1700086399.xml.gz"',
      "",
      base64Content,
      "--boundary123--",
    ].join("\r\n");

    const results = await extractFromEmail(Buffer.from(mimeEmail));
    expect(results).toHaveLength(1);
    expect(results[0]?.filename).toBe("example.org!example.com!1700000000!1700086399.xml.gz");
    expect(results[0]?.xml).toContain("<feedback>");
    expect(results[0]?.xml).toContain("example.org");
  });

  it("extracts plain XML attachment", async () => {
    const base64Content = Buffer.from(sampleXml).toString("base64");

    const mimeEmail = [
      "From: dmarc@example.org",
      "To: dmarc-reports@example.com",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="boundary456"',
      "",
      "--boundary456",
      "Content-Type: text/plain",
      "",
      "Report attached.",
      "--boundary456",
      "Content-Type: application/xml",
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="report.xml"',
      "",
      base64Content,
      "--boundary456--",
    ].join("\r\n");

    const results = await extractFromEmail(Buffer.from(mimeEmail));
    expect(results).toHaveLength(1);
    expect(results[0]?.filename).toBe("report.xml");
    expect(results[0]?.xml).toContain("<feedback>");
  });

  it("skips non-report attachments", async () => {
    const mimeEmail = [
      "From: user@example.org",
      "To: dmarc-reports@example.com",
      "Subject: Hello",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="boundary789"',
      "",
      "--boundary789",
      "Content-Type: text/plain",
      "",
      "This has a PDF attached.",
      "--boundary789",
      "Content-Type: application/pdf",
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="document.pdf"',
      "",
      "JVBERi0xLjQKMSAwIG9iago=",
      "--boundary789--",
    ].join("\r\n");

    const results = await extractFromEmail(Buffer.from(mimeEmail));
    expect(results).toHaveLength(0);
  });

  it("returns empty array for emails without attachments", async () => {
    const mimeEmail = [
      "From: user@example.org",
      "To: dmarc-reports@example.com",
      "Subject: No attachments",
      "Content-Type: text/plain",
      "",
      "Just a plain text email.",
    ].join("\r\n");

    const results = await extractFromEmail(Buffer.from(mimeEmail));
    expect(results).toHaveLength(0);
  });
});
