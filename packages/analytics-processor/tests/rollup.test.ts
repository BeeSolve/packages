import { afterEach, describe, expect, it, mock } from "bun:test";

import { AppliedMarkers } from "../src/appliedMarkers.ts";
import { Breakdowns } from "../src/breakdowns.ts";
import { applyDailyRollup } from "../src/processHour.ts";
import type { TotalsItem } from "../src/totals.ts";
import { Totals } from "../src/totals.ts";

interface RecordedCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") throw new Error("expected object");
  return Object.fromEntries(Object.entries(value));
}

const noopDynamo = { send: async (): Promise<Record<string, unknown>> => ({}) };

function hourlyTotalsItems(): Array<TotalsItem> {
  return Array.from({ length: 24 }, (_unused, hour) => ({
    pk: "totals#hour",
    sk: `2026-02-14-${hour.toString().padStart(2, "0")}`,
    grain: "hour" as const,
    timeKey: `2026-02-14-${hour.toString().padStart(2, "0")}`,
    hits: 10,
    success: 9,
    errors: 1,
    errors4xx: 1,
    errors5xx: 0,
    bytesSent: 100,
    bytesReceived: 50,
  }));
}

function makeDynamo() {
  const sends: Array<RecordedCommand> = [];
  const dynamo = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sends.push({ name: command.constructor.name, input: command.input });
      return {};
    },
  };
  return { dynamo, sends };
}

describe("applyDailyRollup", () => {
  afterEach(() => {
    mock.restore();
  });

  it("sums 24 hourly totals into a totals#day ADD update and writes the applied#day marker, never touching Athena", async () => {
    const items = hourlyTotalsItems();
    const totals = new Totals({ dynamo: noopDynamo, tableName: "t" });
    const breakdowns = new Breakdowns({ dynamo: noopDynamo, tableName: "t" });
    const markers = new AppliedMarkers({ dynamo: noopDynamo, tableName: "t" });
    const { dynamo, sends } = makeDynamo();

    const result = await applyDailyRollup({
      dayKey: "2026-02-14",
      models: {
        totals: {
          buildAggregateUpdate: totals.buildAggregateUpdate,
          queryWindow: async () => items,
        },
        breakdowns: {
          buildUpdates: breakdowns.buildUpdates,
          getForPeriod: async () => [],
        },
        markers: {
          isApplied: async () => false,
          buildMarkerPut: markers.buildMarkerPut,
        },
      },
      dynamo,
    });

    expect(result.status).toBe("applied");
    expect(sends.length).toBe(1);
    const command = sends[0];
    if (command == null) throw new Error("expected a recorded command");
    expect(command.name).toBe("TransactWriteCommand");

    const transactItems = command.input.TransactItems;
    if (!Array.isArray(transactItems)) throw new Error("expected TransactItems");
    const entries = transactItems.map((item) => asRecord(item));

    const marker = entries.find((item) => "Put" in item);
    if (marker == null) throw new Error("expected a marker Put");
    const markerItem = asRecord(asRecord(marker.Put).Item);
    expect(markerItem.pk).toBe("applied#day#2026-02-14");
    expect(markerItem.ttl).toBeUndefined();

    const totalsUpdate = entries.find((item) => {
      const update = asRecord(item.Update ?? {});
      return update.Key != null && asRecord(update.Key).pk === "totals#day";
    });
    if (totalsUpdate == null) throw new Error("expected a totals#day update");
    const update = asRecord(totalsUpdate.Update);
    expect(String(update.UpdateExpression)).toContain("ADD");
    const values = asRecord(update.ExpressionAttributeValues);
    expect(values[":hits"]).toBe(240);
    expect(values[":success"]).toBe(216);
    expect(update.ExpressionAttributeValues).toBeDefined();
    expect(String(update.UpdateExpression)).not.toContain("#ttl");
  });

  it("skips when the day marker already exists", async () => {
    const totals = new Totals({ dynamo: noopDynamo, tableName: "t" });
    const breakdowns = new Breakdowns({ dynamo: noopDynamo, tableName: "t" });
    const markers = new AppliedMarkers({ dynamo: noopDynamo, tableName: "t" });
    const { dynamo, sends } = makeDynamo();

    let queryCalls = 0;
    const result = await applyDailyRollup({
      dayKey: "2026-02-14",
      models: {
        totals: {
          buildAggregateUpdate: totals.buildAggregateUpdate,
          queryWindow: async () => {
            queryCalls += 1;
            return [];
          },
        },
        breakdowns: {
          buildUpdates: breakdowns.buildUpdates,
          getForPeriod: async () => [],
        },
        markers: {
          isApplied: async () => true,
          buildMarkerPut: markers.buildMarkerPut,
        },
      },
      dynamo,
    });

    expect(result.status).toBe("skipped");
    expect(sends.length).toBe(0);
    expect(queryCalls).toBe(0);
  });
});
