import { describe, expect, it, mock } from "bun:test";

import { Domains } from "../domain.ts";

function makeDynamo() {
  const send = mock(() => Promise.resolve({}));
  return { send };
}

function getCommandInput(send: ReturnType<typeof mock>, index = 0): Record<string, unknown> {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
  return command.input as Record<string, unknown>;
}

describe("Domains", () => {
  describe("upsert", () => {
    it("sends an UpdateCommand with correct key and expressions", async () => {
      const dynamo = makeDynamo();
      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await domains.upsert({
        domain: "example.org",
        totalMessages: 10,
        totalPass: 7,
        totalFail: 3,
      });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "domain#example.org", sk: "domain" });
      expect(input.UpdateExpression).toBe(
        "SET #domain = :domain ADD #totalMessages :msgs, #totalPass :pass, #totalFail :fail",
      );
    });

    it("uses ADD for counter fields with correct expression values", async () => {
      const dynamo = makeDynamo();
      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await domains.upsert({ domain: "example.org", totalMessages: 5, totalPass: 4, totalFail: 1 });

      const input = getCommandInput(dynamo.send);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[":domain"]).toBe("example.org");
      expect(values[":msgs"]).toBe(5);
      expect(values[":pass"]).toBe(4);
      expect(values[":fail"]).toBe(1);

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const names = input.ExpressionAttributeNames as Record<string, string>;
      expect(names["#totalMessages"]).toBe("totalMessages");
      expect(names["#totalPass"]).toBe("totalPass");
      expect(names["#totalFail"]).toBe("totalFail");
    });
  });

  describe("list", () => {
    it("queries the reverse GSI with correct key condition", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [] });

      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await domains.list();

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.IndexName).toBe("reverse");
      expect(input.KeyConditionExpression).toBe("#pk = :pk");
      expect(input.ExpressionAttributeNames).toEqual({ "#pk": "sk" });
      expect(input.ExpressionAttributeValues).toEqual({ ":pk": "domain" });
    });

    it("parses and returns domain records", async () => {
      const storedItem = {
        pk: "domain#example.org",
        sk: "domain",
        domain: "example.org",
        totalMessages: 100,
        totalPass: 85,
        totalFail: 15,
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [storedItem] });

      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await domains.list();

      expect(result.length).toBe(1);
      expect(result[0]?.domain).toBe("example.org");
      expect(result[0]?.totalMessages).toBe(100);
      expect(result[0]?.totalPass).toBe(85);
      expect(result[0]?.totalFail).toBe(15);
    });

    it("returns empty array when no items", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [] });

      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await domains.list();

      expect(result).toEqual([]);
    });
  });

  describe("getByDomain", () => {
    it("parses and returns the item when present", async () => {
      const storedItem = {
        pk: "domain#example.org",
        sk: "domain",
        domain: "example.org",
        totalMessages: 100,
        totalPass: 85,
        totalFail: 15,
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: storedItem });

      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await domains.getByDomain({ domain: "example.org" });

      expect(result?.domain).toBe("example.org");
      expect(result?.totalMessages).toBe(100);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "domain#example.org", sk: "domain" });
    });

    it("returns null when no item is returned", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({});

      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      const result = await domains.getByDomain({ domain: "example.org" });

      expect(result).toBeNull();
    });
  });

  describe("putDns", () => {
    it("sends an UpdateCommand that sets the dns field", async () => {
      const dns = {
        fetchedAt: "2024-01-01T00:00:00.000Z",
        spf: { raw: "v=spf1 -all", all: "-all", lookupCount: 0, valid: true },
      } as const;

      const dynamo = makeDynamo();
      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await domains.putDns({ domain: "example.org", dns });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "domain#example.org", sk: "domain" });
      expect(input.UpdateExpression).toBe("SET #dns = :dns");
      expect(input.ExpressionAttributeNames).toEqual({ "#dns": "dns" });

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      expect(values[":dns"]).toEqual(dns);
    });
  });

  describe("clearDns", () => {
    it("sends an UpdateCommand that removes the dns field", async () => {
      const dynamo = makeDynamo();
      const domains = new Domains({ dynamo, tableName: "test-table", reverseIndexName: "reverse" });

      await domains.clearDns({ domain: "example.org" });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "domain#example.org", sk: "domain" });
      expect(input.UpdateExpression).toBe("REMOVE #dns");
      expect(input.ExpressionAttributeNames).toEqual({ "#dns": "dns" });
    });
  });
});
