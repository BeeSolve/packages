import { describe, expect, it, mock } from "bun:test";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { UserAlreadyExistsError, UserNotFoundError, Users } from "../src/lib/server/users.ts";

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

describe("Users.getByEmail", () => {
  it("sends GetCommand with correct key and returns the parsed user", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({
      Item: {
        pk: "user#bob@example.com",
        sk: "user",
        email: "bob@example.com",
        type: "admin",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    });
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    const result = await users.getByEmail({ email: "bob@example.com" });

    expect(send).toHaveBeenCalledTimes(1);
    const input = getCommandInput(send);
    expect(input.TableName).toBe("test-table");
    expect(input.Key).toEqual({ pk: "user#bob@example.com", sk: "user" });

    expect(result.email).toBe("bob@example.com");
    expect(result.type).toBe("admin");
    expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("throws UserNotFoundError when item is null", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Item: undefined });
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    expect(users.getByEmail({ email: "nobody@example.com" })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});

describe("Users.create", () => {
  it("sends PutCommand with correct item and composite-key condition expression", async () => {
    const { dynamo, send } = makeDynamo();
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    await users.create({ email: "alice@example.com", type: "user" });

    expect(send).toHaveBeenCalledTimes(1);
    const input = getCommandInput(send);
    expect(input.TableName).toBe("test-table");

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
    const item = input.Item as Record<string, unknown>;
    expect(item.pk).toBe("user#alice@example.com");
    expect(item.sk).toBe("user");
    expect(item.email).toBe("alice@example.com");
    expect(item.type).toBe("user");
    expect(item.createdAt).toBeString();

    expect(input.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
  });

  it("throws UserAlreadyExistsError on ConditionalCheckFailedException", async () => {
    const error = new Error("Condition not met");
    error.name = "ConditionalCheckFailedException";

    const { dynamo, send } = makeDynamo();
    send.mockRejectedValueOnce(error);
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    expect(users.create({ email: "alice@example.com", type: "user" })).rejects.toBeInstanceOf(
      UserAlreadyExistsError,
    );
  });
});

describe("Users.hasAnyUsers", () => {
  it("queries the reverse index with Limit 1 and returns false when empty", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Items: [] });
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    const result = await users.hasAnyUsers();
    expect(result).toBe(false);

    const input = getCommandInput(send);
    expect(input.IndexName).toBe("reverse");
    expect(input.Limit).toBe(1);
  });

  it("returns true when users exist", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Items: [{ pk: "user#a@example.com", sk: "user" }] });
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    const result = await users.hasAnyUsers();
    expect(result).toBe(true);
  });
});

describe("Users.listAll", () => {
  it("returns all users parsed from the reverse index", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({
      Items: [
        {
          pk: "user#a@example.com",
          sk: "user",
          email: "a@example.com",
          type: "admin",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
        {
          pk: "user#b@example.com",
          sk: "user",
          email: "b@example.com",
          type: "user",
          createdAt: "2024-01-02T00:00:00.000Z",
        },
      ],
    });
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    const result = await users.listAll();
    expect(result).toHaveLength(2);
    expect(result.at(0)?.email).toBe("a@example.com");
    expect(result.at(1)?.email).toBe("b@example.com");

    const input = getCommandInput(send);
    expect(input.IndexName).toBe("reverse");
  });

  it("returns an empty array when there are no items", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Items: undefined });
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    const result = await users.listAll();
    expect(result).toEqual([]);
  });
});

describe("Users.updateType", () => {
  it("sends UpdateCommand with correct expression and existence guard", async () => {
    const { dynamo, send } = makeDynamo();
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    await users.updateType({ email: "alice@example.com", type: "admin" });

    expect(send).toHaveBeenCalledTimes(1);
    const input = getCommandInput(send);
    expect(input.TableName).toBe("test-table");
    expect(input.Key).toEqual({ pk: "user#alice@example.com", sk: "user" });
    expect(input.UpdateExpression).toBe("SET #type = :type");
    expect(input.ConditionExpression).toBe("attribute_exists(pk) AND attribute_exists(sk)");
  });

  it("throws UserNotFoundError on ConditionalCheckFailedException", async () => {
    const error = new Error("Condition not met");
    error.name = "ConditionalCheckFailedException";

    const { dynamo, send } = makeDynamo();
    send.mockRejectedValueOnce(error);
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    expect(users.updateType({ email: "nobody@example.com", type: "user" })).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});

describe("Users.delete", () => {
  it("sends DeleteCommand with correct key", async () => {
    const { dynamo, send } = makeDynamo();
    const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

    await users.delete({ email: "alice@example.com" });

    expect(send).toHaveBeenCalledTimes(1);
    const input = getCommandInput(send);
    expect(input.TableName).toBe("test-table");
    expect(input.Key).toEqual({ pk: "user#alice@example.com", sk: "user" });
  });
});
