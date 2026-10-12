import { describe, expect, it } from "bun:test";

import { Breakdowns } from "../src/breakdowns.ts";

interface RecordedCommand {
  readonly input: Record<string, unknown>;
}

function makeDynamo(result: Record<string, unknown> = {}) {
  const recorded: Array<RecordedCommand> = [];
  const dynamo = {
    send: async (command: RecordedCommand): Promise<Record<string, unknown>> => {
      recorded.push(command);
      return result;
    },
  };
  return { dynamo, recorded };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") {
    throw new Error("expected an object");
  }
  return Object.fromEntries(Object.entries(value));
}

function values(command: RecordedCommand): Record<string, unknown> {
  return asRecord(command.input.ExpressionAttributeValues);
}

describe("Breakdowns", () => {
  describe("addMany", () => {
    it("builds one UpdateCommand per item with ADD hits/bytes and bare partition key", async () => {
      const { dynamo, recorded } = makeDynamo();
      const breakdowns = new Breakdowns({ dynamo, tableName: "test-table" });

      await breakdowns.addMany({
        dimension: "path",
        grain: "hour",
        periodKey: "2026-02-14-09",
        items: [
          { value: "/pricing", hits: 10, bytes: 2000 },
          { value: "/about", hits: 4, bytes: 800 },
        ],
        ttl: 1_700_000_000,
      });

      expect(recorded.length).toBe(2);

      const first = recorded[0];
      if (first == null) throw new Error("no command");

      expect(first.input.Key).toEqual({
        pk: "breakdown#path#hour#2026-02-14-09",
        sk: "/pricing",
      });

      const expression = first.input.UpdateExpression;
      if (typeof expression !== "string") throw new Error("expected string expression");
      expect(expression).toContain("ADD #hits :hits, #bytes :bytes");
      expect(expression).toContain("#dimension = :dimension");
      expect(expression).toContain("#value = :value");
      expect(expression).toContain("#ttl = :ttl");

      const commandValues = values(first);
      expect(commandValues[":hits"]).toBe(10);
      expect(commandValues[":bytes"]).toBe(2000);
      expect(commandValues[":ttl"]).toBe(1_700_000_000);
    });

    it("omits ttl for day grain", async () => {
      const { dynamo, recorded } = makeDynamo();
      const breakdowns = new Breakdowns({ dynamo, tableName: "test-table" });

      await breakdowns.addMany({
        dimension: "status",
        grain: "day",
        periodKey: "2026-02-14",
        items: [{ value: "404", hits: 3, bytes: 90 }],
      });

      const command = recorded[0];
      if (command == null) throw new Error("no command");

      const expression = command.input.UpdateExpression;
      if (typeof expression !== "string") throw new Error("expected string expression");
      expect(expression).not.toContain("#ttl");
      expect(command.input.Key).toEqual({
        pk: "breakdown#status#day#2026-02-14",
        sk: "404",
      });
      expect(values(command)[":ttl"]).toBeUndefined();
    });
  });

  describe("getForPeriod", () => {
    it("queries with a bare pk condition (no BETWEEN)", async () => {
      const { dynamo, recorded } = makeDynamo({ Items: [] });
      const breakdowns = new Breakdowns({ dynamo, tableName: "test-table" });

      await breakdowns.getForPeriod({
        dimension: "country",
        grain: "hour",
        periodKey: "2026-02-14-09",
      });

      const command = recorded[0];
      if (command == null) throw new Error("no command");

      expect(command.input.KeyConditionExpression).toBe("#pk = :pk");
      expect(command.input.ExpressionAttributeNames).toEqual({ "#pk": "pk" });
      expect(values(command)[":pk"]).toBe("breakdown#country#hour#2026-02-14-09");
    });

    it("parses returned items", async () => {
      const stored = {
        pk: "breakdown#country#hour#2026-02-14-09",
        sk: "US",
        dimension: "country",
        grain: "hour",
        periodKey: "2026-02-14-09",
        value: "US",
        hits: 50,
        bytes: 12345,
      };
      const { dynamo } = makeDynamo({ Items: [stored] });
      const breakdowns = new Breakdowns({ dynamo, tableName: "test-table" });

      const result = await breakdowns.getForPeriod({
        dimension: "country",
        grain: "hour",
        periodKey: "2026-02-14-09",
      });

      expect(result.length).toBe(1);
      expect(result[0]?.value).toBe("US");
      expect(result[0]?.hits).toBe(50);
    });
  });
});
