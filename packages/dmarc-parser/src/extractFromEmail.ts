import { simpleParser } from "mailparser";

import { decompress } from "./decompress.ts";

export interface ExtractedReport {
  filename: string;
  xml: string;
}

export async function extractFromEmail(raw: Buffer): Promise<Array<ExtractedReport>> {
  const parsed = await simpleParser(raw);
  const results: Array<ExtractedReport> = [];

  if (parsed.attachments == null) {
    return results;
  }

  for (const attachment of parsed.attachments) {
    const filename = attachment.filename ?? "";
    const isReport =
      filename.endsWith(".xml.gz") ||
      filename.endsWith(".xml.zip") ||
      filename.endsWith(".zip") ||
      filename.endsWith(".gz") ||
      filename.endsWith(".xml");

    if (!isReport) continue;

    const xml = decompress(attachment.content, filename);
    results.push({ filename, xml });
  }

  return results;
}
