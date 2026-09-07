export interface ReportKey {
  readonly timestamp: number;
  readonly orgName: string;
  readonly reportId: string;
}

export function encodeReportKey(key: ReportKey): string {
  return btoa(JSON.stringify(key)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeReportKey(encoded: string): unknown {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(base64));
}
