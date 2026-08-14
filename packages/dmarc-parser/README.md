# @beesolve/dmarc-parser

DMARC aggregate report parser — XML parsing, decompression, and MIME email extraction.

## Installation

```bash
npm install @beesolve/dmarc-parser
```

## Usage

### Parse XML report

```typescript
import { parseXml } from "@beesolve/dmarc-parser";

const report = parseXml(xmlString);
// report.reportMetadata.orgName → "google.com"
// report.policyPublished.domain → "example.com"
// report.records[0].sourceIp → "203.0.113.1"
```

### Decompress a gzipped or zipped report

```typescript
import { decompress } from "@beesolve/dmarc-parser";

// Auto-detects format from filename extension (.gz, .zip, or raw .xml)
const xml = decompress(buffer, "report.xml.gz");
const report = parseXml(xml);
```

### Extract reports from a MIME email

```typescript
import { extractFromEmail, parseXml } from "@beesolve/dmarc-parser";

// Parses email, finds DMARC attachments, decompresses them
const extracted = await extractFromEmail(rawEmailBuffer);

for (const { filename, xml } of extracted) {
  const report = parseXml(xml);
  console.log(`${filename}: ${report.records.length} records`);
}
```

## API

### `parseXml(xml: string): DmarcReport`

Parses a DMARC aggregate report XML string into a validated, typed object. Handles snake_case to camelCase transformation and XML single-element-vs-array normalization.

### `decompress(buffer: Buffer, filename: string): string`

Auto-detects format by filename extension:

- `.gz` — gzip decompression
- `.zip` — extracts first `.xml` file from zip archive
- otherwise — returns raw UTF-8 string

### `decompressGzip(buffer: Buffer): string`

Decompresses a gzip buffer to UTF-8 string.

### `decompressZip(buffer: Buffer): string`

Extracts the first `.xml` file from a zip archive.

### `extractFromEmail(raw: Buffer): Promise<ExtractedReport[]>`

Parses a raw MIME email buffer, finds DMARC report attachments (by extension: `.xml.gz`, `.xml.zip`, `.zip`, `.gz`, `.xml`), decompresses them, and returns the XML strings.

### `dmarcReportSchema`

Valibot schema for validating a `DmarcReport` object.

## Types

```typescript
interface DmarcReport {
  version?: string;
  reportMetadata: {
    orgName: string;
    email: string;
    extraContactInfo?: string;
    reportId: string;
    dateRange: { begin: number; end: number };
    errors?: string[];
  };
  policyPublished: {
    domain: string;
    adkim: "r" | "s";
    aspf: "r" | "s";
    p: "none" | "quarantine" | "reject";
    sp?: "none" | "quarantine" | "reject";
    np?: "none" | "quarantine" | "reject";
    pct: number;
    fo?: string;
  };
  records: DmarcRecord[];
}

interface DmarcRecord {
  sourceIp: string;
  count: number;
  policyEvaluated: {
    disposition: "none" | "quarantine" | "reject";
    dkim: "pass" | "fail";
    spf: "pass" | "fail";
    reason?: Array<{ type: string; comment?: string }>;
  };
  identifiers: {
    headerFrom: string;
    envelopeTo?: string;
    envelopeFrom?: string;
  };
  authResults: {
    dkim: Array<{ domain: string; result: string; selector?: string }>;
    spf: Array<{ domain: string; result: string; scope?: string }>;
  };
}

interface ExtractedReport {
  filename: string;
  xml: string;
}
```

## License

[MIT](../../LICENSE)
