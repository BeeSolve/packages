import { negotiateFormat } from "./accept";
import { canonicalizeQuery } from "./query";

export interface CloudFrontQueryValue {
  value: string;
  multiValue?: Array<{ value: string }>;
}

export interface CloudFrontHeader {
  value: string;
  multiValue?: Array<{ value: string }>;
}

export interface CloudFrontRequest {
  method: string;
  uri: string;
  querystring: Record<string, CloudFrontQueryValue> | string;
  headers: Record<string, CloudFrontHeader>;
  cookies?: Record<string, { value: string }>;
}

export interface CloudFrontResponse {
  statusCode: number;
  statusDescription: string;
  headers: Record<string, { value: string }>;
  body: string;
}

export interface CloudFrontEvent {
  request: CloudFrontRequest;
}

/**
 * CloudFront Function (viewer request) for the image behaviors. Canonicalizes the query string
 * and normalizes `Accept`, so equivalent URLs share one cache entry. Requests with unsupported
 * parameters or path traversal are answered with 400 at the edge.
 *
 * The build bundles this file into a single ES5 script, `handler` is called by CloudFront.
 */
export function handler(event: CloudFrontEvent): CloudFrontRequest | CloudFrontResponse {
  const request = event.request;

  if (hasTraversal(request.uri)) return badRequest("Invalid path");

  const canonical = canonicalizeQuery(rawQuery(request.querystring));
  if ("error" in canonical) return badRequest(canonical.error);
  request.querystring = canonical.query === "" ? {} : canonical.query;

  const accept = request.headers.accept;
  const format = negotiateFormat(accept == null ? undefined : headerValue(accept));
  request.headers.accept = { value: format === "webp" ? "image/webp" : "*/*" };

  return request;
}

function badRequest(message: string): CloudFrontResponse {
  return {
    statusCode: 400,
    statusDescription: "Bad Request",
    headers: {
      "content-type": { value: "text/plain; charset=utf-8" },
      "cache-control": { value: "no-store" },
    },
    body: message,
  };
}

function rawQuery(querystring: CloudFrontRequest["querystring"]): string {
  if (typeof querystring === "string") return querystring;

  const pairs: Array<string> = [];
  Object.keys(querystring).forEach((key) => {
    const entry = querystring[key];
    if (entry == null) return;
    const values = entry.multiValue == null ? [entry] : entry.multiValue;
    values.forEach((item) => pairs.push(`${key}=${item.value}`));
  });
  return pairs.join("&");
}

function headerValue(header: CloudFrontHeader): string {
  if (header.multiValue == null) return header.value;
  return header.multiValue.map((item) => item.value).join(",");
}

function hasTraversal(uri: string): boolean {
  return uri.split("/").some((segment) => {
    const decoded = safeDecode(segment);
    if (decoded == null) return true;
    return decoded === "." || decoded === ".." || decoded.indexOf("/") !== -1;
  });
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
