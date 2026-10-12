import { describe, expect, it } from "bun:test";

import type { TotalsInput } from "../src/totals.ts";
import { Totals } from "../src/totals.ts";

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

function names(command: RecordedCommand): Record<string, string> {
  const record = asRecord(command.input.ExpressionAttributeNames);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") throw new Error("expected string name");
    result[key] = value;
  }
  return result;
}

const sampleItem: TotalsInput = {
  timeKey: "2026-02-14-09",
  hits: 100,
  success: 90,
  errors: 10,
  errors4xx: 7,
  errors5xx: 3,
  bytesSent: 5000,
  bytesReceived: 2000,
  p50TimeTaken: 0.12,
  p95TimeTaken: 0.45,
  cacheHitRatio: 0.8,
  uniqueIpCount: 42,
};

describe("Totals", () => {
  describe("addHourly", () => {
    it("sends an UpdateCommand with ADD for additive numerics and SET for metadata + detail + ttl", async () => {
      const { dynamo, recorded } = makeDynamo();
      const totals = new Totals({ dynamo, tableName: "test-table" });

      await totals.addHourly({ item: sampleItem, ttl: 1_700_000_000 });

      expect(recorded.length).toBe(1);
      const command = recorded[0];
      if (command == null) throw new Error("no command");

      expect(command.input.TableName).toBe("test-table");
      expect(command.input.Key).toEqual({ pk: "totals#hour", sk: "2026-02-14-09" });

      const expression = command.input.UpdateExpression;
      if (typeof expression !== "string") throw new Error("expected string expression");

      expect(expression).toContain("ADD ");
      for (const field of [
        "hits",
        "success",
        "errors",
        "errors4xx",
        "errors5xx",
        "bytesSent",
        "bytesReceived",
      ]) {
        expect(expression).toContain(`#${field} :${field}`);
      }

      expect(expression).toContain("#grain = :grain");
      expect(expression).toContain("#timeKey = :timeKey");
      expect(expression).toContain("#ttl = :ttl");
      expect(expression).toContain("#p95TimeTaken = :p95TimeTaken");

      const commandValues = values(command);
      expect(commandValues[":grain"]).toBe("hour");
      expect(commandValues[":ttl"]).toBe(1_700_000_000);
      expect(commandValues[":hits"]).toBe(100);
      expect(names(command)["#bytesReceived"]).toBe("bytesReceived");
    });
  });

  describe("addAggregate", () => {
    it("day grain has no ttl and no hourly-only detail fields", async () => {
      const { dynamo, recorded } = makeDynamo();
      const totals = new Totals({ dynamo, tableName: "test-table" });

      await totals.addAggregate({ grain: "day", item: sampleItem });

      const command = recorded[0];
      if (command == null) throw new Error("no command");

      expect(command.input.Key).toEqual({ pk: "totals#day", sk: "2026-02-14-09" });

      const expression = command.input.UpdateExpression;
      if (typeof expression !== "string") throw new Error("expected string expression");

      expect(expression).not.toContain("#ttl");
      expect(expression).not.toContain("p95TimeTaken");
      expect(expression).not.toContain("p50TimeTaken");
      expect(expression).not.toContain("cacheHitRatio");
      expect(expression).not.toContain("uniqueIpCount");
      expect(expression).toContain("#hits :hits");

      expect(values(command)[":ttl"]).toBeUndefined();
    });

    it("month grain writes to the month partition", async () => {
      const { dynamo, recorded } = makeDynamo();
      const totals = new Totals({ dynamo, tableName: "test-table" });

      await totals.addAggregate({ grain: "month", item: sampleItem });

      const command = recorded[0];
      if (command == null) throw new Error("no command");
      expect(command.input.Key).toEqual({ pk: "totals#month", sk: "2026-02-14-09" });
    });
  });

  describe("queryWindow", () => {
    it("issues a Query with BETWEEN key condition on the correct partition", async () => {
      const { dynamo, recorded } = makeDynamo({ Items: [] });
      const totals = new Totals({ dynamo, tableName: "test-table" });

      await totals.queryWindow({
        grain: "hour",
        startKey: "2026-02-13-10",
        endKey: "2026-02-14-09",
      });

      const command = recorded[0];
      if (command == null) throw new Error("no command");

      expect(command.input.KeyConditionExpression).toBe(
        "#pk = :pk AND #sk BETWEEN :start AND :end",
      );
      const commandValues = values(command);
      expect(commandValues[":pk"]).toBe("totals#hour");
      expect(commandValues[":start"]).toBe("2026-02-13-10");
      expect(commandValues[":end"]).toBe("2026-02-14-09");
    });

    it("parses the returned items", async () => {
      const stored = {
        pk: "totals#hour",
        sk: "2026-02-14-09",
        grain: "hour",
        timeKey: "2026-02-14-09",
        hits: 100,
        success: 90,
        errors: 10,
        errors4xx: 7,
        errors5xx: 3,
        bytesSent: 5000,
        bytesReceived: 2000,
      };
      const { dynamo } = makeDynamo({ Items: [stored] });
      const totals = new Totals({ dynamo, tableName: "test-table" });

      const result = await totals.queryWindow({
        grain: "hour",
        startKey: "2026-02-14-09",
        endKey: "2026-02-14-09",
      });

      expect(result.length).toBe(1);
      expect(result[0]?.hits).toBe(100);
    });
  });

  describe("getOne", () => {
    it("returns undefined when there is no item", async () => {
      const { dynamo } = makeDynamo({});
      const totals = new Totals({ dynamo, tableName: "test-table" });

      const result = await totals.getOne({ grain: "day", timeKey: "2026-02-14" });
      expect(result).toBeUndefined();
    });
  });
});
