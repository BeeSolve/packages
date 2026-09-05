import { describe, expect, it, mock } from "bun:test";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { Setup } from "../src/lib/server/setup.ts";

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

describe("Setup.isComplete", () => {
  it("returns false when the setup item does not exist", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Item: undefined });
    const setup = new Setup({ dynamo, tableName: "test-table" });

    const result = await setup.isComplete();
    expect(result).toBe(false);

    const input = getCommandInput(send);
    expect(input.TableName).toBe("test-table");
    expect(input.Key).toEqual({ pk: "system#config", sk: "setup" });
  });

  it("returns true when the setup item exists", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({
      Item: {
        pk: "system#config",
        sk: "setup",
        completedAt: "2024-01-01T00:00:00.000Z",
        adminEmail: "admin@example.com",
      },
    });
    const setup = new Setup({ dynamo, tableName: "test-table" });

    const result = await setup.isComplete();
    expect(result).toBe(true);
  });
});

describe("Setup.markComplete", () => {
  it("writes the setup item once with a composite-key guard", async () => {
    const { dynamo, send } = makeDynamo();
    const setup = new Setup({ dynamo, tableName: "test-table" });

    await setup.markComplete({ adminEmail: "admin@example.com" });

    expect(send).toHaveBeenCalledTimes(1);
    const input = getCommandInput(send);
    expect(input.TableName).toBe("test-table");

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
    const item = input.Item as Record<string, unknown>;
    expect(item.pk).toBe("system#config");
    expect(item.sk).toBe("setup");
    expect(item.adminEmail).toBe("admin@example.com");
    expect(item.completedAt).toBeString();

    expect(input.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
  });
});
