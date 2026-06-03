import { describe, expect, test } from "bun:test";

import * as v from "valibot";

import { requestSchema } from "../src/validation";

function parse(input: unknown) {
  return v.safeParse(requestSchema, input);
}

const minimal = {
  id: "req-1",
  recipients: ["alice@example.com"],
  subject: "Hello",
  html: "<p>Hi</p>",
};

describe("requestSchema", () => {
  test("accepts a minimal valid request", () => {
    expect(parse(minimal).success).toBe(true);
  });

  test("accepts a fully populated request", () => {
    const result = parse({
      ...minimal,
      text: "Hi",
      sender: { name: "Bot", emailAddress: "bot@example.com" },
      attachments: [
        {
          type: "public",
          mimeType: "application/pdf",
          publicUrl: "https://example.com/file.pdf",
          customName: "file.pdf",
        },
        {
          type: "s3",
          mimeType: "image/png",
          fileId: "s3-key-123",
          customName: "image.png",
        },
      ],
      configurationSetName: "my-config",
    });
    expect(result.success).toBe(true);
  });

  test("normalizes recipient email to lowercase", () => {
    const result = parse({ ...minimal, recipients: ["ALICE@EXAMPLE.COM"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.recipients[0]).toBe("alice@example.com");
    }
  });

  test("rejects invalid recipient email", () => {
    expect(parse({ ...minimal, recipients: ["not-an-email"] }).success).toBe(false);
  });

  test("rejects missing required fields", () => {
    expect(parse({ id: "req-1", recipients: ["a@b.com"] }).success).toBe(false);
  });

  test("rejects invalid sender email", () => {
    const result = parse({
      ...minimal,
      sender: { name: "Bot", emailAddress: "not-an-email" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown attachment type", () => {
    const result = parse({
      ...minimal,
      attachments: [{ type: "ftp", mimeType: "text/plain", fileId: "123", customName: "f.txt" }],
    });
    expect(result.success).toBe(false);
  });
});
