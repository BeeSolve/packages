import { describe, expect, it, mock } from "bun:test";

import type { BackfillConfig } from "../backfill.ts";
import { Backfill, deriveCanRun } from "../backfill.ts";

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

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") {
    throw new Error("Expected an object");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed above
  return value as Record<string, unknown>;
}

function configWith(
  domain: string,
  status: BackfillConfig["domains"][string]["status"],
  startedAt = new Date().toISOString(),
): BackfillConfig {
  return {
    pk: "system#config",
    sk: "ipBackfill",
    domains: {
      [domain]: {
        status,
        runId: "run-1",
        startedAt,
      },
    },
  };
}

describe("Backfill", () => {
  describe("startRun", () => {
    it("seeds the domains map, then sends a guarded config Update and a guarded history Put", async () => {
      const dynamo = makeDynamo();
      const backfill = new Backfill({ dynamo, tableName: "t" });

      await backfill.startRun({
        domain: "example.com",
        runId: "run-123",
        startedAt: "2024-01-01T00:00:00.000Z",
      });

      expect(dynamo.send).toHaveBeenCalledTimes(2);

      const seed = getCommandInput(dynamo.send, 0);
      expect(seed.Key).toEqual({ pk: "system#config", sk: "ipBackfill" });
      expect(seed.UpdateExpression).toBe("SET #domains = if_not_exists(#domains, :empty)");
      expect(asRecord(seed.ExpressionAttributeValues)[":empty"]).toEqual({});

      const input = getCommandInput(dynamo.send, 1);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const transactItems = input.TransactItems as Array<Record<string, unknown>>;
      expect(transactItems.length).toBe(2);

      const configUpdate = asRecord(transactItems[0]?.Update);
      expect(configUpdate.Key).toEqual({ pk: "system#config", sk: "ipBackfill" });

      const condition = configUpdate.ConditionExpression;
      expect(typeof condition).toBe("string");
      // Guards on the nested status: a missing entry, a terminal status
      // (finished/failed), or a stale started run may start a run.
      expect(condition).toContain("attribute_not_exists(#domains.#domain)");
      expect(condition).toContain("#domains.#domain.#status IN (:finished, :failed)");
      expect(condition).toContain("#domains.#domain.#startedAt < :staleBefore");

      const names = asRecord(configUpdate.ExpressionAttributeNames);
      expect(names["#domain"]).toBe("example.com");

      const values = asRecord(configUpdate.ExpressionAttributeValues);
      expect(values[":finished"]).toBe("finished");
      expect(values[":failed"]).toBe("failed");
      expect(typeof values[":staleBefore"]).toBe("string");

      const historyPut = asRecord(transactItems[1]?.Put);
      expect(historyPut.ConditionExpression).toBe(
        "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      );
      const historyItem = asRecord(historyPut.Item);
      expect(historyItem.pk).toBe("backfill#example.com");
      expect(historyItem.sk).toBe("run#run-123");
      expect(historyItem.status).toBe("started");
    });
  });

  describe("completeRun", () => {
    it("sends a single transaction updating both the config entry and the run history item", async () => {
      const dynamo = makeDynamo();
      const backfill = new Backfill({ dynamo, tableName: "t" });

      await backfill.completeRun({
        domain: "example.com",
        runId: "run-123",
        ipsEnriched: 42,
        reportsScanned: 100,
      });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const transactItems = input.TransactItems as Array<Record<string, unknown>>;
      expect(transactItems.length).toBe(2);

      const configUpdate = asRecord(transactItems[0]?.Update);
      expect(configUpdate.Key).toEqual({ pk: "system#config", sk: "ipBackfill" });
      const configValues = asRecord(configUpdate.ExpressionAttributeValues);
      expect(configValues[":status"]).toBe("finished");
      expect(configValues[":ipsEnriched"]).toBe(42);
      expect(configValues[":reportsScanned"]).toBe(100);
      expect(typeof configValues[":finishedAt"]).toBe("string");

      const historyUpdate = asRecord(transactItems[1]?.Update);
      expect(historyUpdate.Key).toEqual({ pk: "backfill#example.com", sk: "run#run-123" });
      const historyValues = asRecord(historyUpdate.ExpressionAttributeValues);
      expect(historyValues[":status"]).toBe("finished");
      expect(historyValues[":ipsEnriched"]).toBe(42);
      expect(historyValues[":reportsScanned"]).toBe(100);
      expect(historyValues[":finishedAt"]).toBe(configValues[":finishedAt"]);
    });
  });

  describe("failRun", () => {
    it("sends a single transaction updating both the config entry and the run history item with the error", async () => {
      const dynamo = makeDynamo();
      const backfill = new Backfill({ dynamo, tableName: "t" });

      await backfill.failRun({ domain: "example.com", runId: "run-123", error: "boom" });

      expect(dynamo.send).toHaveBeenCalledTimes(1);

      const input = getCommandInput(dynamo.send);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
      const transactItems = input.TransactItems as Array<Record<string, unknown>>;
      expect(transactItems.length).toBe(2);

      const configUpdate = asRecord(transactItems[0]?.Update);
      expect(configUpdate.Key).toEqual({ pk: "system#config", sk: "ipBackfill" });
      const configValues = asRecord(configUpdate.ExpressionAttributeValues);
      expect(configValues[":status"]).toBe("failed");
      expect(configValues[":error"]).toBe("boom");

      const historyUpdate = asRecord(transactItems[1]?.Update);
      expect(historyUpdate.Key).toEqual({ pk: "backfill#example.com", sk: "run#run-123" });
      const historyValues = asRecord(historyUpdate.ExpressionAttributeValues);
      expect(historyValues[":status"]).toBe("failed");
      expect(historyValues[":error"]).toBe("boom");
    });
  });

  describe("readConfig", () => {
    it("returns null when the config item is not found", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: undefined });

      const backfill = new Backfill({ dynamo, tableName: "t" });
      const result = await backfill.readConfig();

      expect(result).toBeNull();
    });

    it("parses and returns the stored config", async () => {
      const dynamo = makeDynamo();
      dynamo.send.mockResolvedValueOnce({ Item: configWith("example.com", "finished") });

      const backfill = new Backfill({ dynamo, tableName: "t" });
      const result = await backfill.readConfig();

      expect(result?.domains["example.com"]?.status).toBe("finished");
    });
  });
});

describe("deriveCanRun", () => {
  it("returns true when the config record is not found", () => {
    expect(deriveCanRun(null, "example.com")).toBe(true);
  });

  it("returns true when the domain is absent from the config", () => {
    const config = configWith("other.com", "started");
    expect(deriveCanRun(config, "example.com")).toBe(true);
  });

  it("returns false when the domain status is started", () => {
    const config = configWith("example.com", "started");
    expect(deriveCanRun(config, "example.com")).toBe(false);
  });

  it("returns false when the domain status is pending", () => {
    const config = configWith("example.com", "pending");
    expect(deriveCanRun(config, "example.com")).toBe(false);
  });

  it("returns true when a started run is stale (older than the worker lifetime)", () => {
    const config = configWith("example.com", "started", "2024-01-01T00:00:00.000Z");
    expect(deriveCanRun(config, "example.com")).toBe(true);
  });

  it("returns true when the domain status is finished", () => {
    const config = configWith("example.com", "finished");
    expect(deriveCanRun(config, "example.com")).toBe(true);
  });

  it("returns true when the domain status is failed", () => {
    const config = configWith("example.com", "failed");
    expect(deriveCanRun(config, "example.com")).toBe(true);
  });
});
