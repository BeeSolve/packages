import { describe, expect, it, mock } from "bun:test";

import { UserAlreadyExistsError, UserNotFoundError, Users } from "../src/lib/server/users.ts";

function makeDynamo() {
  const send = mock(() => Promise.resolve({}));
  return { send };
}

function getCommandInput(send: ReturnType<typeof mock>, index = 0): Record<string, unknown> {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
  return command.input as Record<string, unknown>;
}

describe("Users", () => {
  describe("getByEmail", () => {
    it("sends GetCommand with correct key", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({
        Item: {
          pk: "user#alice@example.com",
          sk: "user",
          email: "alice@example.com",
          type: "user",
          domains: ["example.com"],
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await users.getByEmail({ email: "alice@example.com" });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "user#alice@example.com", sk: "user" });
    });

    it("returns parsed user when item exists", async () => {
      const storedItem = {
        pk: "user#bob@example.com",
        sk: "user",
        email: "bob@example.com",
        type: "admin",
        domains: ["example.com", "example.org"],
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: storedItem });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await users.getByEmail({ email: "bob@example.com" });

      expect(result.pk).toBe("user#bob@example.com");
      expect(result.sk).toBe("user");
      expect(result.email).toBe("bob@example.com");
      expect(result.type).toBe("admin");
      expect(result.domains).toEqual(["example.com", "example.org"]);
      expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
    });

    it("throws UserNotFoundError when item is null", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: undefined });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      expect(users.getByEmail({ email: "nobody@example.com" })).rejects.toBeInstanceOf(
        UserNotFoundError,
      );
    });
  });

  describe("create", () => {
    it("sends PutCommand with correct item and condition expression", async () => {
      const dynamo = makeDynamo();
      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await users.create({ email: "alice@example.com", type: "user", domains: ["example.com"] });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
      const item = input.Item as Record<string, unknown>;
      expect(item.pk).toBe("user#alice@example.com");
      expect(item.sk).toBe("user");
      expect(item.email).toBe("alice@example.com");
      expect(item.type).toBe("user");
      expect(item.domains).toEqual(["example.com"]);
      expect(item.createdAt).toBeString();

      expect(input.ConditionExpression).toBe(
        "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      );
    });

    it("throws UserAlreadyExistsError on ConditionalCheckFailedException", async () => {
      const error = new Error("Condition not met");
      error.name = "ConditionalCheckFailedException";

      const dynamo = makeDynamo();
      dynamo.send.mockRejectedValueOnce(error);

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      expect(
        users.create({ email: "alice@example.com", type: "user", domains: ["example.com"] }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError);
    });
  });

  describe("hasAnyUsers", () => {
    it("returns false when no users exist", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [] });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await users.hasAnyUsers();
      expect(result).toBe(false);

      const input = getCommandInput(dynamo.send);
      expect(input.IndexName).toBe("reverse");
      expect(input.Limit).toBe(1);
    });

    it("returns true when users exist", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({
        Items: [{ pk: "user#a@example.com", sk: "user" }],
      });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await users.hasAnyUsers();
      expect(result).toBe(true);
    });
  });

  describe("listAll", () => {
    it("returns all users from the reverse index", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({
        Items: [
          {
            pk: "user#a@example.com",
            sk: "user",
            email: "a@example.com",
            type: "admin",
            domains: [],
            createdAt: "2024-01-01T00:00:00.000Z",
          },
          {
            pk: "user#b@example.com",
            sk: "user",
            email: "b@example.com",
            type: "user",
            domains: ["example.com"],
            createdAt: "2024-01-02T00:00:00.000Z",
          },
        ],
      });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await users.listAll();
      expect(result).toHaveLength(2);
      expect(result.at(0)?.email).toBe("a@example.com");
      expect(result.at(1)?.email).toBe("b@example.com");
    });

    it("returns empty array when no items", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: undefined });

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await users.listAll();
      expect(result).toEqual([]);
    });
  });

  describe("updateDomains", () => {
    it("sends UpdateCommand with correct expression", async () => {
      const dynamo = makeDynamo();
      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await users.updateDomains({ email: "alice@example.com", domains: ["new.com"] });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "user#alice@example.com", sk: "user" });
      expect(input.UpdateExpression).toBe("SET #domains = :domains");
      expect(input.ConditionExpression).toBe("attribute_exists(pk) AND attribute_exists(sk)");
    });

    it("throws UserNotFoundError on ConditionalCheckFailedException", async () => {
      const error = new Error("Condition not met");
      error.name = "ConditionalCheckFailedException";

      const dynamo = makeDynamo();
      dynamo.send.mockRejectedValueOnce(error);

      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      expect(
        users.updateDomains({ email: "nobody@example.com", domains: [] }),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe("delete", () => {
    it("sends DeleteCommand with correct key", async () => {
      const dynamo = makeDynamo();
      const users = new Users({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await users.delete({ email: "alice@example.com" });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "user#alice@example.com", sk: "user" });
    });
  });
});
