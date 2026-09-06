import { describe, expect, it, mock } from "bun:test";

import { NoSuchKey, type S3Client } from "@aws-sdk/client-s3";

import { Requests, type EmailRequest } from "../src/lib/server/requests.ts";

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict {
  if (value == null || typeof value !== "object") {
    throw new Error("Expected an object");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
  return value as Dict;
}

function commandInput(send: ReturnType<typeof mock>, index = 0): Dict {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at index ${String(index)}`);
  }
  return asDict(command.input);
}

const messageId = "0100abc-messageid";

const request: EmailRequest = {
  id: "req-1",
  recipients: ["recipient@example.com"],
  subject: "Hello",
  html: "<p>hi</p>",
  text: "hi",
  sender: { name: "Sender", emailAddress: "sender@example.com" },
};

function makeS3() {
  const send = mock(() => Promise.resolve<Record<string, unknown>>({}));
  const s3: Pick<S3Client, "send"> = { send };
  return { s3, send };
}

describe("Requests.put", () => {
  it("writes the request JSON under messages/<messageId>.json", async () => {
    const { s3, send } = makeS3();
    const requests = new Requests({ s3, bucketName: "bucket" });

    await requests.put({ messageId, request });

    const input = commandInput(send);
    expect(input.Bucket).toBe("bucket");
    expect(input.Key).toBe(`messages/${messageId}.json`);
    expect(input.ContentType).toBe("application/json");
    expect(JSON.parse(String(input.Body))).toEqual(request);
  });
});

describe("Requests.get", () => {
  it("reads and parses the stored request JSON", async () => {
    const send = mock(() =>
      Promise.resolve<Record<string, unknown>>({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(request)) },
      }),
    );
    const s3: Pick<S3Client, "send"> = { send };
    const requests = new Requests({ s3, bucketName: "bucket" });

    const result = await requests.get({ messageId });

    const input = commandInput(send);
    expect(input.Bucket).toBe("bucket");
    expect(input.Key).toBe(`messages/${messageId}.json`);
    expect(result).toEqual(request);
  });

  it("returns null when the object does not exist", async () => {
    const send = mock(() => Promise.reject(new NoSuchKey({ $metadata: {}, message: "nope" })));
    const s3: Pick<S3Client, "send"> = { send };
    const requests = new Requests({ s3, bucketName: "bucket" });

    const result = await requests.get({ messageId });

    expect(result).toBeNull();
  });

  it("rethrows unexpected errors", async () => {
    const send = mock(() => Promise.reject(new Error("boom")));
    const s3: Pick<S3Client, "send"> = { send };
    const requests = new Requests({ s3, bucketName: "bucket" });

    expect(requests.get({ messageId })).rejects.toThrow(/boom/);
  });
});
