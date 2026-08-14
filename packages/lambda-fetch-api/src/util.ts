// adjusted code from nitro project
// @see https://github.com/nitrojs/nitro/blob/dfdff9e93d0fa16b48afe5d9f0c44a87b4b5d249/src/presets/aws-lambda/runtime/_utils.ts

import { assertUnreachable } from "@beesolve/helpers";
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";

import { isAPIGatewayProxyEvent } from "./runtime.js";

// Incoming (AWS => Web)

export function awsRequest(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Request {
  const method = awsEventMethod(event);
  const url = awsEventURL(event);
  const headers = awsEventHeaders(event);
  const body = awsEventBody(event);
  return new Request(url, { method, headers, body });
}

function awsEventMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  if (isAPIGatewayProxyEvent(event)) {
    return event.httpMethod;
  }
  return event.requestContext?.http?.method || "GET";
}

function awsEventURL(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): URL {
  const origin = event.headers.origin || event.headers.Origin;
  const hostname =
    origin != null
      ? new URL(origin).host
      : event.headers.host || event.headers.Host || event.requestContext?.domainName || ".";

  const path = "path" in event ? event.path : event.rawPath;

  const query = awsEventQuery(event);

  const protocol =
    (event.headers["X-Forwarded-Proto"] || event.headers["x-forwarded-proto"]) === "http"
      ? "http"
      : "https";

  return new URL(`${path}${query ? `?${query}` : ""}`, `${protocol}://${hostname}`);
}

function awsEventQuery(event: APIGatewayProxyEvent | APIGatewayProxyEventV2) {
  if ("rawQueryString" in event && typeof event.rawQueryString === "string") {
    return event.rawQueryString;
  }

  const searchParams = new URLSearchParams();

  if ("multiValueQueryStringParameters" in event) {
    for (const [name, values] of Object.entries(event.multiValueQueryStringParameters ?? {})) {
      for (const value of values ?? []) {
        searchParams.append(name, value);
      }
    }
  }

  return searchParams.toString();
}

function awsEventHeaders(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers)) {
    if (value) {
      headers.set(key, value);
    }
  }
  if ("cookies" in event && event.cookies) {
    for (const cookie of event.cookies) {
      headers.append("cookie", cookie);
    }
  }
  return headers;
}

function awsEventBody(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): BodyInit | undefined {
  if (!event.body) {
    return undefined;
  }
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || "", "base64");
  }
  return event.body;
}

// Outgoing (Web => AWS)

// oxlint-disable-next-line beesolve/prefer-props-object
export function awsResponseHeaders(
  response: Response,
  version: "v1" | "v2",
):
  | {
      headers: Record<string, string>;
      multiValueHeaders?: { "set-cookie": Array<string> };
    }
  | {
      headers: Record<string, string>;
      cookies?: Array<string>;
    } {
  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }

  const cookies = response.headers.getSetCookie();

  if (cookies.length === 0) {
    return { headers };
  }

  delete headers["set-cookie"];

  if (version === "v1") {
    return {
      headers,
      multiValueHeaders: { "set-cookie": cookies },
    };
  }

  if (version === "v2") {
    return {
      headers,
      cookies,
    };
  }

  assertUnreachable(version);
}

// AWS Lambda proxy integrations requires base64 encoded buffers
// binaryMediaTypes should be */*
// see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-payload-encodings.html
export async function awsResponseBody(
  response: Response,
): Promise<{ body: string; isBase64Encoded?: boolean }> {
  if (!response.body) {
    return { body: "" };
  }
  const buffer = await toBuffer(response.body);
  const contentType = response.headers.get("content-type") || "";
  return isTextType(contentType)
    ? { body: buffer.toString("utf8") }
    : { body: buffer.toString("base64"), isBase64Encoded: true };
}

function isTextType(contentType = "") {
  return /^text\/|\/(javascript|json|xml)\b|utf-?8/i.test(contentType);
}

function toBuffer(data: ReadableStream): Promise<Buffer> {
  // oxlint-disable-next-line beesolve/prefer-props-object
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    data
      .pipeTo(
        new WritableStream({
          write(chunk) {
            chunks.push(chunk);
          },
          close() {
            resolve(Buffer.concat(chunks));
          },
          abort(reason) {
            reject(reason instanceof Error ? reason : new Error(String(reason)));
          },
        }),
      )
      .catch(reject);
  });
}
