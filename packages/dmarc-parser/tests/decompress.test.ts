import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";

import { decompress, decompressGzip, decompressZip } from "../src/decompress.ts";

const sampleXml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.org</org_name>
    <email>dmarc@example.org</email>
    <report_id>test-123</report_id>
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

describe("decompressGzip", () => {
  it("decompresses gzipped content", () => {
    const compressed = gzipSync(Buffer.from(sampleXml));
    const result = decompressGzip(compressed);
    expect(result).toBe(sampleXml);
  });
});

describe("decompressZip", () => {
  it("extracts XML from a zip archive", () => {
    const zipBuffer = createMinimalZip("report.xml", sampleXml);
    const result = decompressZip(zipBuffer);
    expect(result).toBe(sampleXml);
  });

  it("throws when no XML found in zip", () => {
    const zipBuffer = createMinimalZip("readme.txt", "Not XML");
    expect(() => decompressZip(zipBuffer)).toThrow("No XML file found in zip archive");
  });
});

describe("decompress", () => {
  it("decompresses .gz files", () => {
    const compressed = gzipSync(Buffer.from(sampleXml));
    const result = decompress(compressed, "report.xml.gz");
    expect(result).toBe(sampleXml);
  });

  it("decompresses .zip files", () => {
    const zipBuffer = createMinimalZip("report.xml", sampleXml);
    const result = decompress(zipBuffer, "report.zip");
    expect(result).toBe(sampleXml);
  });

  it("returns raw string for .xml files", () => {
    const result = decompress(Buffer.from(sampleXml), "report.xml");
    expect(result).toBe(sampleXml);
  });
});

/**
 * Creates a minimal valid zip file with a single stored (uncompressed) entry.
 */
function createMinimalZip(filename: string, content: string): Buffer {
  const fileData = Buffer.from(content);
  const nameBuffer = Buffer.from(filename);

  // Local file header
  const localHeader = Buffer.alloc(30 + nameBuffer.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
  localHeader.writeUInt16LE(20, 4); // Version needed to extract
  localHeader.writeUInt16LE(0, 6); // General purpose bit flag
  localHeader.writeUInt16LE(0, 8); // Compression method (stored)
  localHeader.writeUInt16LE(0, 10); // Last mod file time
  localHeader.writeUInt16LE(0, 12); // Last mod file date
  localHeader.writeUInt32LE(0, 14); // CRC-32
  localHeader.writeUInt32LE(fileData.length, 18); // Compressed size
  localHeader.writeUInt32LE(fileData.length, 22); // Uncompressed size
  localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
  localHeader.writeUInt16LE(0, 28); // Extra field length
  nameBuffer.copy(localHeader, 30);

  // Central directory header
  const centralHeader = Buffer.alloc(46 + nameBuffer.length);
  centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory header signature
  centralHeader.writeUInt16LE(20, 4); // Version made by
  centralHeader.writeUInt16LE(20, 6); // Version needed to extract
  centralHeader.writeUInt16LE(0, 8); // General purpose bit flag
  centralHeader.writeUInt16LE(0, 10); // Compression method (stored)
  centralHeader.writeUInt16LE(0, 12); // Last mod file time
  centralHeader.writeUInt16LE(0, 14); // Last mod file date
  centralHeader.writeUInt32LE(0, 16); // CRC-32
  centralHeader.writeUInt32LE(fileData.length, 20); // Compressed size
  centralHeader.writeUInt32LE(fileData.length, 24); // Uncompressed size
  centralHeader.writeUInt16LE(nameBuffer.length, 28); // File name length
  centralHeader.writeUInt16LE(0, 30); // Extra field length
  centralHeader.writeUInt16LE(0, 32); // File comment length
  centralHeader.writeUInt16LE(0, 34); // Disk number start
  centralHeader.writeUInt16LE(0, 36); // Internal file attributes
  centralHeader.writeUInt32LE(0, 38); // External file attributes
  centralHeader.writeUInt32LE(0, 42); // Relative offset of local header
  nameBuffer.copy(centralHeader, 46);

  const centralDirOffset = localHeader.length + fileData.length;

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(1, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(1, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralHeader.length, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([localHeader, fileData, centralHeader, eocd]);
}
