export { parseXml } from "./src/parseXml.ts";
export { decompress, decompressGzip, decompressZip } from "./src/decompress.ts";
export { extractFromEmail } from "./src/extractFromEmail.ts";
export { dmarcReportSchema } from "./src/schema.ts";
export type {
  AuthResults,
  DkimAuthResult,
  DmarcRecord,
  DmarcReport,
  PolicyEvaluated,
  PolicyPublished,
  ReportMetadata,
  SpfAuthResult,
} from "./src/schema.ts";
export type { ExtractedReport } from "./src/extractFromEmail.ts";
