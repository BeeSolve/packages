import { timingSafeEqual } from "node:crypto";

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { originTokenEnvVar, originTokenHeader } from "./shared";

type Fetch = (request: Request) => Promise<Response>;

/**
 * Wraps a `Fetch` handler so requests without a matching origin token are
 * rejected with a 403 before reaching the inner handler. Fail-closed: a
 * missing or misconfigured token always rejects.
 */
export function protectFetch(fetch: Fetch): Fetch {
  return async (request: Request): Promise<Response> => {
    const expected = process.env[originTokenEnvVar];
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
 * Wraps an AWS Lambda proxy handler so events without a matching origin token
 * are rejected with a 403 proxy result before reaching the inner handler.
 * Fail-closed: a missing or misconfigured token always rejects.
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
    const expected = process.env[originTokenEnvVar];
    const presented = readHeader(event, originTokenHeader);

    if (!tokensMatch(expected, presented)) {
      return { statusCode: 403, headers: { "cache-control": "no-store" }, body: "" };
    }

    return handler(event, context);
  };
}

function tokensMatch(expected: string | undefined, presented: string | null): boolean {
  if (expected == null || expected.length === 0) return false;
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
