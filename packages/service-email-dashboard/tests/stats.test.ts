import { describe, expect, it, mock } from "bun:test";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { GlobalStats } from "../src/lib/server/stats.ts";

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

describe("GlobalStats.get", () => {
  it("parses and returns counters when the item exists", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({
      Item: { pk: "stats", sk: "global", received: 10, delivered: 7, bounced: 2 },
    });
    const stats = new GlobalStats({ dynamo, tableName: "t" });

    const result = await stats.get();

    expect(getCommandInput(send).Key).toEqual({ pk: "stats", sk: "global" });
    expect(result.received).toBe(10);
    expect(result.delivered).toBe(7);
    expect(result.bounced).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(19);
  });

  it("returns zero-filled stats when the item is absent", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({});
    const stats = new GlobalStats({ dynamo, tableName: "t" });

    const result = await stats.get();

    expect(getCommandInput(send).Key).toEqual({ pk: "stats", sk: "global" });
    expect(result).toEqual({
      received: 0,
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      rejected: 0,
      failed: 0,
      total: 0,
    });
  });
});
