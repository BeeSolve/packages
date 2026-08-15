import { describe, expect, it, mock } from "bun:test";

import { ProcessingStats } from "../processingStats.ts";

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

describe("ProcessingStats", () => {
  describe("increment", () => {
    it("sends UpdateCommand with ADD expression for the specified counter", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "processed", date: "2026-08-14" });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "stats#daily", sk: "2026-08-14" });
      expect(input.UpdateExpression).toBe("ADD #counter :val");
      expect(input.ExpressionAttributeNames).toEqual({ "#counter": "processed" });
      expect(input.ExpressionAttributeValues).toEqual({ ":val": 1 });
    });

    it("increments by a custom value", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "processed", value: 5, date: "2026-08-14" });

      const input = getCommandInput(dynamo.send);
      expect(input.ExpressionAttributeValues).toEqual({ ":val": 5 });
    });

    it("increments authRejected counter", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "authRejected", date: "2026-08-14" });

      const input = getCommandInput(dynamo.send);
      expect(input.ExpressionAttributeNames).toEqual({ "#counter": "authRejected" });
    });

    it("increments spamRejected counter", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "spamRejected", date: "2026-08-14" });

      const input = getCommandInput(dynamo.send);
      expect(input.ExpressionAttributeNames).toEqual({ "#counter": "spamRejected" });
    });

    it("increments virusRejected counter", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "virusRejected", date: "2026-08-14" });

      const input = getCommandInput(dynamo.send);
      expect(input.ExpressionAttributeNames).toEqual({ "#counter": "virusRejected" });
    });

    it("increments manualUpload counter", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "manualUpload", date: "2026-08-14" });

      const input = getCommandInput(dynamo.send);
      expect(input.ExpressionAttributeNames).toEqual({ "#counter": "manualUpload" });
    });

    it("defaults to today UTC when no date is provided", async () => {
      const dynamo = makeDynamo();
      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.increment({ counter: "processed" });

      const input = getCommandInput(dynamo.send);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const key = input.Key as { pk: string; sk: string };
      expect(key.sk).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("queryRange", () => {
    it("queries with correct key condition for date range", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [] });

      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      await stats.queryRange({ startDate: "2026-08-01", endDate: "2026-08-14" });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      expect(input.TableName).toBe("test-table");
      expect(input.KeyConditionExpression).toBe("#pk = :pk AND #sk BETWEEN :start AND :end");
      expect(input.ExpressionAttributeNames).toEqual({ "#pk": "pk", "#sk": "sk" });
      expect(input.ExpressionAttributeValues).toEqual({
        ":pk": "stats#daily",
        ":start": "2026-08-01",
        ":end": "2026-08-14",
      });
    });

    it("parses and returns stats records", async () => {
      const storedItem = {
        pk: "stats#daily",
        sk: "2026-08-14",
        processed: 42,
        manualUpload: 3,
        authRejected: 5,
        spamRejected: 2,
        virusRejected: 1,
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [storedItem] });

      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      const result = await stats.queryRange({ startDate: "2026-08-14", endDate: "2026-08-14" });

      expect(result.length).toBe(1);
      expect(result[0]?.processed).toBe(42);
      expect(result[0]?.manualUpload).toBe(3);
      expect(result[0]?.authRejected).toBe(5);
      expect(result[0]?.spamRejected).toBe(2);
      expect(result[0]?.virusRejected).toBe(1);
      expect(result[0]?.sk).toBe("2026-08-14");
    });

    it("returns empty array when no items exist", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [] });

      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      const result = await stats.queryRange({ startDate: "2026-08-01", endDate: "2026-08-14" });

      expect(result).toEqual([]);
    });

    it("defaults missing counter fields to 0", async () => {
      const storedItem = {
        pk: "stats#daily",
        sk: "2026-08-14",
        processed: 10,
      };

      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Items: [storedItem] });

      const stats = new ProcessingStats({ dynamo, tableName: "test-table" });

      const result = await stats.queryRange({ startDate: "2026-08-14", endDate: "2026-08-14" });

      expect(result[0]?.manualUpload).toBe(0);
      expect(result[0]?.authRejected).toBe(0);
      expect(result[0]?.spamRejected).toBe(0);
      expect(result[0]?.virusRejected).toBe(0);
    });
  });
});
