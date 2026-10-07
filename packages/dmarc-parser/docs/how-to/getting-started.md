# How to: Get started with the DMARC parser

> Full source: https://github.com/BeeSolve/packages/tree/main/packages/dmarc-parser

## Prerequisites

- Node.js 24+ (or Bun)
- A DMARC aggregate report as XML, a compressed file, or a raw MIME email

## Steps

### 1. Install

```sh
bun add @beesolve/dmarc-parser
```

```sh
npm install @beesolve/dmarc-parser
```

### 2. Parse an XML report

`parseXml` validates the report and returns a typed `DmarcReport` with
camelCased fields and normalized single-vs-array elements.

```ts
import { parseXml } from "@beesolve/dmarc-parser";

const report = parseXml(xmlString);
console.log(report.reportMetadata.orgName);
console.log(report.policyPublished.domain);
console.log(report.records[0].sourceIp);
```

### 3. Decompress before parsing

Reports usually arrive gzipped or zipped. `decompress` picks the format from the
filename extension (`.gz`, `.zip`, or raw `.xml`).

```ts
import { decompress, parseXml } from "@beesolve/dmarc-parser";

const xml = decompress(buffer, "report.xml.gz");
const report = parseXml(xml);
```

### 4. Extract reports from a raw email

`extractFromEmail` parses a MIME email, finds DMARC attachments, and
decompresses each one.

```ts
import { extractFromEmail, parseXml } from "@beesolve/dmarc-parser";

const extracted = await extractFromEmail(rawEmailBuffer);
for (const { filename, xml } of extracted) {
  const report = parseXml(xml);
  console.log(filename, report.records.length);
}
```

## Common Pitfalls

- `parseXml` throws on reports that fail schema validation — wrap it in a try/catch when parsing untrusted input.
- `decompress` keys off the filename extension, not the file contents, so pass the real filename.
- A single email can carry multiple attachments; always iterate the array `extractFromEmail` returns.

## See Also

- [README](../../README.md) — full API, `DmarcReport` type, and `dmarcReportSchema`
- [@beesolve/dmarc-reports](https://github.com/BeeSolve/packages/tree/main/packages/dmarc-reports) — ingestion pipeline that uses this parser
