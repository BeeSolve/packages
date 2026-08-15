import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { gzipSync } from "node:zlib";

process.env.EVENT_BUS_ARN = "arn:aws:events:us-east-1:123456789012:event-bus/default";

interface PutEventsEntry {
  Source: string;
  DetailType: string;
  Detail: string;
  EventBusName: string;
}

interface PutEventsInput {
  Entries: Array<PutEventsEntry>;
}

const putEventsCalls: Array<PutEventsInput> = [];
let s3Body: Buffer | undefined;

void mock.module("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send() {
      return Promise.resolve({
        Body: {
          transformToByteArray: () => Promise.resolve(s3Body),
        },
      });
    }
  },
  GetObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

void mock.module("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: class {
    send(command: { input: PutEventsInput }) {
      putEventsCalls.push(command.input);
      return Promise.resolve({ FailedEntryCount: 0, Entries: [{}] });
    }
  },
  PutEventsCommand: class {
    input: PutEventsInput;
    constructor(input: PutEventsInput) {
      this.input = input;
    }
  },
}));

void mock.module("@beesolve/lambda-keep-active/runtime", () => ({
  // oxlint-disable-next-line typescript/no-explicit-any
  keptActive: (handler: any) => handler,
}));

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <report_metadata>
    <org_name>Example Corp</org_name>
    <email>postmaster@example.com</email>
    <report_id>report-001</report_id>
    <date_range>
      <begin>1704067200</begin>
      <end>1704153600</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.org</domain>
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
      <header_from>example.org</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>example.org</domain>
        <result>pass</result>
      </dkim>
      <spf>
        <domain>example.org</domain>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
</feedback>`;

function findStatsEvent(counter: string): PutEventsEntry | undefined {
  for (const call of putEventsCalls) {
    for (const entry of call.Entries) {
      if (entry.DetailType === "DmarcProcessingStats") {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
        const detail = JSON.parse(entry.Detail) as { counter: string; value: number };
        if (detail.counter === counter) {
          return entry;
        }
      }
    }
  }
  return undefined;
}

function findReportEvents(): Array<PutEventsEntry> {
  const results: Array<PutEventsEntry> = [];
  for (const call of putEventsCalls) {
    for (const entry of call.Entries) {
      if (entry.DetailType === "DmarcReportParsed") {
        results.push(entry);
      }
    }
  }
  return results;
}

describe("handler", () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    putEventsCalls.length = 0;
    s3Body = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("processes a gzipped XML report from S3 and emits to EventBridge", async () => {
    s3Body = gzipSync(Buffer.from(sampleXml));

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/report.xml.gz" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(1);

    const entry = reportEvents[0];
    expect(entry).toBeDefined();
    if (entry == null) return;

    expect(entry.Source).toBe("dmarc-reports");
    expect(entry.DetailType).toBe("DmarcReportParsed");
    expect(entry.EventBusName).toBe("arn:aws:events:us-east-1:123456789012:event-bus/default");

    const detail = JSON.parse(entry.Detail);
    expect(detail.reportMetadata.orgName).toBe("Example Corp");
    expect(detail.policyPublished.domain).toBe("example.org");
    expect(detail.records[0].sourceIp).toBe("192.0.2.1");
  });

  it("emits manualUpload and processed stats events for a direct upload (no auth header)", async () => {
    s3Body = gzipSync(Buffer.from(sampleXml));

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/report.xml.gz" },
        },
      },
      {},
    );

    const manualEntry = findStatsEvent("manualUpload");
    const processedEntry = findStatsEvent("processed");

    expect(manualEntry).toBeDefined();
    expect(processedEntry).toBeDefined();
  });

  it("processes a raw email (MIME) from S3", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(1);

    const entry = reportEvents[0];
    expect(entry).toBeDefined();
    if (entry == null) return;

    const detail = JSON.parse(entry.Detail);
    expect(detail.reportMetadata.reportId).toBe("report-001");
  });

  it("throws on invalid event input", async () => {
    const { handler } = await import("../src/handler.ts");

    const result = handler({ invalid: "event" }, {});
    expect(result).rejects.toThrow();
  });

  it("does not emit report events and emits authRejected stats when neither SPF nor DKIM passes", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: amazonses.com; spf=fail (spfCheck: domain of example.com) client-ip=192.0.2.1; dkim=fail header.i=@example.com; dmarc=fail header.from=example.com",
      "X-SES-Spam-Verdict: PASS",
      "X-SES-Virus-Verdict: PASS",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(0);

    const authRejectedEntry = findStatsEvent("authRejected");
    expect(authRejectedEntry).toBeDefined();
  });

  it("processes email when SPF fails but DKIM passes", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: amazonses.com; spf=fail (spfCheck: domain of example.com) client-ip=192.0.2.1; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(1);
  });

  it("processes email when both SPF and DKIM pass", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: amazonses.com; spf=pass (spfCheck: domain of example.com) client-ip=192.0.2.1; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(1);
  });

  it("skips auth check when Authentication-Results is not from amazonses.com", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: some-other-provider.com; spf=fail; dkim=fail",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(1);
  });

  it("does not emit report events and emits spamRejected stats when email is flagged as spam", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: amazonses.com; spf=pass (spfCheck: domain of example.com) client-ip=192.0.2.1; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com",
      "X-SES-Spam-Verdict: FAIL",
      "X-SES-Virus-Verdict: PASS",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(0);

    const spamEntry = findStatsEvent("spamRejected");
    expect(spamEntry).toBeDefined();
  });

  it("does not emit report events and emits virusRejected stats when email contains a virus", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: amazonses.com; spf=pass (spfCheck: domain of example.com) client-ip=192.0.2.1; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com",
      "X-SES-Spam-Verdict: PASS",
      "X-SES-Virus-Verdict: FAIL",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "DMARC aggregate report attached.",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(0);

    const virusEntry = findStatsEvent("virusRejected");
    expect(virusEntry).toBeDefined();
  });

  it("emits processed stats event with the number of reports", async () => {
    const gzipped = gzipSync(Buffer.from(sampleXml));
    const boundary = "----=_Part_123";
    const mimeEmail = [
      "Authentication-Results: amazonses.com; spf=pass; dkim=pass",
      "From: noreply@example.com",
      "To: dmarc@example.org",
      "Subject: DMARC Report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: application/gzip",
      `Content-Disposition: attachment; filename="report.xml.gz"`,
      "Content-Transfer-Encoding: base64",
      "",
      gzipped.toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");

    s3Body = Buffer.from(mimeEmail);

    const { handler } = await import("../src/handler.ts");

    await handler(
      {
        detail: {
          bucket: { name: "test-bucket" },
          object: { key: "inbox/abc123def456" },
        },
      },
      {},
    );

    const reportEvents = findReportEvents();
    expect(reportEvents.length).toBe(1);

    const processedEntry = findStatsEvent("processed");
    expect(processedEntry).toBeDefined();
    if (processedEntry == null) return;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
    const detail = JSON.parse(processedEntry.Detail) as { counter: string; value: number };
    expect(detail.value).toBe(1);
  });
});
