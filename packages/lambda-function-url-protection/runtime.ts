import { timingSafeEqual } from "node:crypto";

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { originTokenEnvVar, originTokenHeader } from "./shared";

type Fetch = (request: Request) => Promise<Response>;

/**
 * Wraps a `Fetch` handler so requests whose origin token does not match are
 * rejected with a 403 before reaching the inner handler.
 *
 * Enforcement is opt-in by environment: it engages only when `ORIGIN_TOKEN` is
 * set to a non-empty value (which `protectedFunctionUrlOrigin` does for the
 * Function URL origin). When `ORIGIN_TOKEN` is unset or empty, the request is
 * passed through unchanged, so the same handler can also serve origins that do
 * not use the token mechanism (for example an API Gateway origin). While
 * enforcement is engaged it is fail-closed: a missing or mismatched header is
 * rejected.
 */
export function protectFetch(fetch: Fetch): Fetch {
  return async (request: Request): Promise<Response> => {
    const expected = expectedToken();
    if (expected == null) return fetch(request);

    const presented = request.headers.get(originTokenHeader);
    if (!tokensMatch(expected, presented)) {
      return new Response(null, {
        status: 403,
        headers: { "cache-control": "no-store" },
      });
    }

    return fetch(request);
  };
}

/**
 * Wraps an AWS Lambda proxy handler so events whose origin token does not match
 * are rejected with a 403 proxy result before reaching the inner handler.
 *
 * Enforcement is opt-in by environment: it engages only when `ORIGIN_TOKEN` is
 * set to a non-empty value (which `protectedFunctionUrlOrigin` does for the
 * Function URL origin). When `ORIGIN_TOKEN` is unset or empty, the event is
 * passed through unchanged, so the same handler can also serve origins that do
 * not use the token mechanism (for example an API Gateway origin). While
 * enforcement is engaged it is fail-closed: a missing or mismatched header is
 * rejected.
 *
 * The wrapped handler's own result type is preserved; the only shape this
 * wrapper introduces is the 403 proxy result, so `Result` is unconstrained and
 * may be a v1 result, a v2 result, or a union of both.
 */
export function protectHandler<Event, Context, Result>(
  handler: (event: Event, context: Context) => Promise<Result>,
): (event: Event, context: Context) => Promise<Result | APIGatewayProxyStructuredResultV2> {
  return async (
    event: Event,
    context: Context,
  ): Promise<Result | APIGatewayProxyStructuredResultV2> => {
    const expected = expectedToken();
    if (expected == null) return handler(event, context);

    const presented = readHeader(event, originTokenHeader);
    if (!tokensMatch(expected, presented)) {
      return { statusCode: 403, headers: { "cache-control": "no-store" }, body: "" };
    }

    return handler(event, context);
  };
}

function expectedToken(): string | null {
  const value = process.env[originTokenEnvVar];
  if (value == null || value.length === 0) return null;
  return value;
}

function tokensMatch(expected: string, presented: string | null): boolean {
  if (presented == null) return false;

  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);

  if (expectedBuffer.length !== presentedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

interface WithHeaders {
  readonly headers?: Record<string, string | undefined>;
}

function hasHeaders(event: unknown): event is WithHeaders {
  return event != null && typeof event === "object" && "headers" in event;
}

function readHeader(event: unknown, header: string): string | null {
  if (!hasHeaders(event)) return null;

  const headers = event.headers;
  if (headers == null) return null;

  const target = header.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") return value;
  }

  return null;
}
