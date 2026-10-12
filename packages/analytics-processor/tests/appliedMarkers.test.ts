import { describe, expect, it } from "bun:test";

import { AppliedMarkers } from "../src/appliedMarkers.ts";

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

describe("AppliedMarkers", () => {
  describe("buildMarkerPut", () => {
    it("produces a conditional Put guarding both key attributes with ttl for hourly", () => {
      const { dynamo } = makeDynamo();
      const markers = new AppliedMarkers({ dynamo, tableName: "test-table" });

      const put = markers.buildMarkerPut({
        grain: "hour",
        periodKey: "2026-02-14-09",
        source: "v2",
        ttl: 1_700_000_000,
      });

      expect(put.Put.ConditionExpression).toBe(
        "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      );
      expect(put.Put.TableName).toBe("test-table");

      const item = put.Put.Item;
      if (item == null) throw new Error("missing item");
      expect(item.pk).toBe("applied#hour#2026-02-14-09");
      expect(item.sk).toBe("applied");
      expect(item.source).toBe("v2");
      expect(item.ttl).toBe(1_700_000_000);
      expect(typeof item.appliedAt).toBe("number");
    });

    it("omits ttl when not provided", () => {
      const { dynamo } = makeDynamo();
      const markers = new AppliedMarkers({ dynamo, tableName: "test-table" });

      const put = markers.buildMarkerPut({
        grain: "day",
        periodKey: "2026-02-14",
        source: "v1",
      });

      const item = put.Put.Item;
      if (item == null) throw new Error("missing item");
      expect(item.pk).toBe("applied#day#2026-02-14");
      expect(item.ttl).toBeUndefined();
      expect(item.source).toBe("v1");
    });
  });

  describe("isApplied", () => {
    it("returns true when the Get returns an item", async () => {
      const { dynamo, recorded } = makeDynamo({ Item: { pk: "applied#hour#2026-02-14-09" } });
      const markers = new AppliedMarkers({ dynamo, tableName: "test-table" });

      const result = await markers.isApplied({ grain: "hour", periodKey: "2026-02-14-09" });
      expect(result).toBe(true);

      const command = recorded[0];
      if (command == null) throw new Error("no command");
      expect(command.input.Key).toEqual({ pk: "applied#hour#2026-02-14-09", sk: "applied" });
    });

    it("returns false when the Get returns no item", async () => {
      const { dynamo } = makeDynamo({});
      const markers = new AppliedMarkers({ dynamo, tableName: "test-table" });

      const result = await markers.isApplied({ grain: "month", periodKey: "2026-02" });
      expect(result).toBe(false);
    });
  });
});
