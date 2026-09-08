import { describe, expect, it, mock } from "bun:test";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { Recipients } from "../src/lib/server/recipients.ts";

function makeDynamo() {
  const send = mock(() => Promise.resolve<Record<string, unknown>>({}));
  const dynamo: Pick<DynamoDBDocumentClient, "send"> = { send };
  return { dynamo, send };
}

function getCommandInput(send: ReturnType<typeof mock>, index = 0): Record<string, unknown> {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
  return command.input as Record<string, unknown>;
}

function values(command: Record<string, unknown>): Record<string, unknown> {
  const attributeValues = command.ExpressionAttributeValues;
  if (attributeValues == null || typeof attributeValues !== "object") {
    throw new Error("Expected ExpressionAttributeValues");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
  return attributeValues as Record<string, unknown>;
}

describe("Recipients.list", () => {
  it("queries the reverse index by sk=recipient, parses items and round-trips the cursor", async () => {
    const { dynamo, send } = makeDynamo();
    const lastKey = { pk: "b@example.com", sk: "recipient" };
    send.mockResolvedValueOnce({
      Items: [
        { pk: "a@example.com", sk: "recipient", delivered: 3 },
        { pk: "b@example.com", sk: "recipient", bounced: 1 },
      ],
      LastEvaluatedKey: lastKey,
    });
    const recipients = new Recipients({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const result = await recipients.list({ limit: 50 });

    const input = getCommandInput(send);
    expect(input.IndexName).toBe("reverse");
    expect(values(input)[":sk"]).toBe("recipient");
    expect(input.Limit).toBe(50);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.pk).toBe("a@example.com");
    expect(result.items[0]?.delivered).toBe(3);
    expect(result.items[1]?.bounced).toBe(1);

    expect(result.cursor).toBeString();
    const decoded = JSON.parse(Buffer.from(result.cursor ?? "", "base64").toString("utf8"));
    expect(decoded).toEqual(lastKey);
  });
});

describe("Recipients.getStats", () => {
  it("parses the stored recipient when present", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({
      Item: { pk: "recipient@example.com", sk: "recipient", delivered: 3, bounced: 1 },
    });
    const recipients = new Recipients({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const result = await recipients.getStats({ email: "Recipient@Example.com" });

    expect(getCommandInput(send).Key).toEqual({ pk: "recipient@example.com", sk: "recipient" });
    expect(result.email).toBe("recipient@example.com");
    expect(result.stats.delivered).toBe(3);
    expect(result.stats.bounced).toBe(1);
    expect(result.stats.sent).toBe(0);
  });

  it("returns a zero-filled recipient for the normalized email when absent", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({});
    const recipients = new Recipients({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const result = await recipients.getStats({ email: "  Recipient@Example.com  " });

    expect(getCommandInput(send).Key).toEqual({ pk: "recipient@example.com", sk: "recipient" });
    expect(result).toEqual({
      email: "recipient@example.com",
      stats: {
        received: 0,
        sent: 0,
        delivered: 0,
        bounced: 0,
        complained: 0,
        rejected: 0,
        failed: 0,
      },
    });
  });
});
