import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { CloudFrontRequestEvent } from "aws-lambda";
import { handler } from "../src/edgeBodyHash.ts";

function makeEvent(
  body?: { data: string; encoding: "base64" | "text" },
): CloudFrontRequestEvent {
  return {
    Records: [
      {
        cf: {
          config: {
            distributionDomainName: "d123.cloudfront.net",
            distributionId: "D123",
            eventType: "origin-request",
            requestId: "req-1",
          },
          request: {
            clientIp: "1.2.3.4",
            method: "POST",
            uri: "/auth/signInRequest",
            querystring: "",
            headers: {},
            ...(body && {
              body: { action: "read-only" as const, inputTruncated: false, ...body },
            }),
          },
        },
      },
    ],
  };
}

describe("edgeBodyHash", () => {
  test("sets x-amz-content-sha256 for base64-encoded body", async () => {
    const payload = JSON.stringify({ emailAddress: "a@b.com" });
    const event = makeEvent({
      data: Buffer.from(payload).toString("base64"),
      encoding: "base64",
    });

    const result = await handler(event);
    const expected = createHash("sha256").update(payload).digest("hex");

    expect(result).toHaveProperty(
      ["headers", "x-amz-content-sha256", 0, "value"],
      expected,
    );
  });

  test("sets x-amz-content-sha256 for text-encoded body", async () => {
    const payload = '{"code":"123456"}';
    const event = makeEvent({ data: payload, encoding: "text" });

    const result = await handler(event);
    const expected = createHash("sha256").update(payload).digest("hex");

    expect(result).toHaveProperty(
      ["headers", "x-amz-content-sha256", 0, "value"],
      expected,
    );
  });

  test("passes request through without body unchanged", async () => {
    const event = makeEvent();

    const result = await handler(event);

    expect(result).not.toHaveProperty([
      "headers",
      "x-amz-content-sha256",
    ]);
    expect(result).toHaveProperty("uri", "/auth/signInRequest");
  });
});
