import type { ImageOptimizerConfig } from "./config";
import type { IntermediateStore } from "./intermediates";
import { parseParams } from "./params";
import type { ImageParams } from "./params";
import { processImage } from "./pipeline";
import { textResponse } from "./responses";
import type { ImageSource } from "./source";

export interface FetchHandlerProps {
  config: ImageOptimizerConfig;
  source: ImageSource;
  store: IntermediateStore;
}

export function createFetchHandler(
  props: FetchHandlerProps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse(405, "Method Not Allowed");
    }
    const url = new URL(request.url);

    const key = pathToKey({ pathname: url.pathname, assetsPrefix: props.config.assetsPrefix });
    if ("error" in key) return textResponse(key.status, key.error);

    const params = tryParseParams(url.search);
    if ("error" in params) return textResponse(400, params.error);

    return processImage({
      source: props.source,
      store: props.store,
      key: key.key,
      params: params.params,
      accept: request.headers.get("accept") ?? undefined,
      config: props.config,
    });
  };
}

export interface PathToKeyProps {
  pathname: string;
  assetsPrefix: string;
}

export type PathToKeyResult = { key: string } | { error: string; status: 400 | 404 };

/**
 * Maps a request path to the S3 key of the original. The key is the decoded path, so the same
 * object is addressed with and without transformation parameters. Only keys below the assets
 * prefix are served. Rejects traversal and empty segments.
 */
export function pathToKey(props: PathToKeyProps): PathToKeyResult {
  const prefixSegments = props.assetsPrefix.split("/").filter((segment) => segment !== "");
  const segments = props.pathname.replace(/^\//, "").split("/");

  const prefixMatches = prefixSegments.every((segment, index) => segments[index] === segment);
  if (!prefixMatches) return { error: "Not Found", status: 404 };

  const keySegments = segments.slice(prefixSegments.length);
  if (keySegments.length === 1 && keySegments[0] === "") return { error: "Not Found", status: 404 };

  const decoded: Array<string> = [];
  for (const segment of keySegments) {
    const value = safeDecode(segment);
    if (value == null) return { error: "Malformed path", status: 400 };
    if (value === "" || value === "." || value === ".." || value.includes("/")) {
      return { error: "Invalid path", status: 400 };
    }
    decoded.push(value);
  }
  return { key: [...prefixSegments, ...decoded].join("/") };
}

function tryParseParams(search: string): { params: ImageParams } | { error: string } {
  try {
    return { params: parseParams(search) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid parameters" };
  }
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
