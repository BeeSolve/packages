import { afterEach, describe, expect, it, mock } from "bun:test";

import { AppliedMarkers } from "../src/appliedMarkers.ts";
import { Breakdowns } from "../src/breakdowns.ts";
import type { ProcessHourModels } from "../src/processHour.ts";
import { processHour } from "../src/processHour.ts";
import { Totals } from "../src/totals.ts";

interface RecordedCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

type Cell = { readonly VarCharValue?: string };
type AthenaRow = { readonly Data: Array<Cell> };

const headerRow: AthenaRow = {
  Data: Array.from({ length: 15 }, (_unused, index) => ({ VarCharValue: `col${index}` })),
};

function dataRow(values: Array<string | undefined>): AthenaRow {
  return { Data: values.map((value) => ({ VarCharValue: value })) };
}

function totalsRow({ hits, cacheHits }: { hits: number; cacheHits: number }): AthenaRow {
  return dataRow([
    undefined,
    undefined,
    undefined,
    undefined,
    String(hits),
    String(hits),
    "0",
    "0",
    "0",
    "1000",
    "500",
    "0.1",
    "0.4",
    String(cacheHits),
    "3",
  ]);
}

function statusRow({ status, hits }: { status: string; hits: number }): AthenaRow {
  return dataRow([
    status,
    undefined,
    undefined,
    undefined,
    String(hits),
    String(hits),
    "0",
    "0",
    "0",
    "100",
    "50",
    "0",
    "0",
    "0",
    "0",
  ]);
}

function pathRow({ path, hits }: { path: string; hits: number }): AthenaRow {
  return dataRow([
    undefined,
    undefined,
    path,
    undefined,
    String(hits),
    String(hits),
    "0",
    "0",
    "0",
    "100",
    "50",
    "0",
    "0",
    "0",
    "0",
  ]);
}

function ipRow({ ip, hits }: { ip: string; hits: number }): AthenaRow {
  return dataRow([
    undefined,
    undefined,
    undefined,
    ip,
    String(hits),
    String(hits),
    "0",
    "0",
    "0",
    "100",
    "50",
    "0",
    "0",
    "0",
    "0",
  ]);
}

function makeAthena(rows: Array<AthenaRow>) {
  const sends: Array<RecordedCommand> = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      sends.push({ name, input: command.input });
      if (name === "StartQueryExecutionCommand") return { QueryExecutionId: "qid-1" };
      if (name === "GetQueryExecutionCommand") {
        return { QueryExecution: { Status: { State: "SUCCEEDED" } } };
      }
      if (name === "GetQueryResultsCommand") {
        return { ResultSet: { Rows: [headerRow, ...rows] } };
      }
      throw new Error(`unexpected athena command ${name}`);
    },
  };
  return { client, sends };
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

function transactItems(command: RecordedCommand): Array<Record<string, unknown>> {
  const items = command.input.TransactItems;
  if (!Array.isArray(items)) throw new Error("expected TransactItems array");
  return items.map((item) => asRecord(item));
}

function firstCommand(sends: Array<RecordedCommand>): RecordedCommand {
  const first = sends[0];
  if (first == null) throw new Error("expected at least one recorded command");
  return first;
}

function requireFound<Value>(value: Value | undefined): Value {
  if (value == null) throw new Error("expected a matching item");
  return value;
}

const noopDynamo = { send: async (): Promise<Record<string, unknown>> => ({}) };

function baseModels(overrides: {
  isApplied: boolean;
  enrichMany?: ProcessHourModels["ipCache"]["enrichMany"];
}): ProcessHourModels {
  const realTotals = new Totals({ dynamo: noopDynamo, tableName: "t" });
  const realBreakdowns = new Breakdowns({ dynamo: noopDynamo, tableName: "t" });
  const realMarkers = new AppliedMarkers({ dynamo: noopDynamo, tableName: "t" });

  return {
    totals: { buildHourlyUpdate: realTotals.buildHourlyUpdate },
    breakdowns: { buildUpdates: realBreakdowns.buildUpdates },
    markers: {
      isApplied: async () => overrides.isApplied,
      buildMarkerPut: realMarkers.buildMarkerPut,
    },
    ipCache: {
      enrichMany: overrides.enrichMany ?? (async () => ({})),
    },
  };
}

const athenaConfig = {
  database: "db",
  table: "cf_logs_v2_table",
  workgroup: "wg",
};

describe("processHour", () => {
  afterEach(() => {
    mock.restore();
  });

  it("skips without Athena or writes when marker already applied", async () => {
    const { client, sends: athenaSends } = makeAthena([]);
    const { dynamo, sends: dynamoSends } = makeDynamo();
    const models = baseModels({ isApplied: true });

    const result = await processHour({
      hourKey: "2026-02-14-09",
      models,
      athena: { client, ...athenaConfig },
      options: { topPaths: 100, hourlyTtlDays: 90 },
      dynamo,
    });

    expect(result.status).toBe("skipped");
    expect(athenaSends.length).toBe(0);
    expect(dynamoSends.length).toBe(0);
  });

  it("writes a transaction with marker Put, totals ADD, and per-dimension breakdowns; country uses ZZ without api key", async () => {
    const rows = [
      totalsRow({ hits: 10, cacheHits: 5 }),
      statusRow({ status: "200", hits: 8 }),
      pathRow({ path: "/pricing", hits: 6 }),
      ipRow({ ip: "1.2.3.4", hits: 10 }),
    ];
    const { client } = makeAthena(rows);
    const { dynamo, sends: dynamoSends } = makeDynamo();
    const models = baseModels({ isApplied: false });

    const result = await processHour({
      hourKey: "2026-02-14-09",
      models,
      athena: { client, ...athenaConfig },
      options: { topPaths: 100, hourlyTtlDays: 90 },
      dynamo,
    });

    expect(result.status).toBe("applied");
    expect(dynamoSends.length).toBe(1);

    const items = transactItems(firstCommand(dynamoSends));
    const put = requireFound(items.find((item) => "Put" in item));
    const putMembers = asRecord(put.Put);
    expect(putMembers.ConditionExpression).toContain("attribute_not_exists(pk)");

    const updates = items.filter((item) => "Update" in item);
    const addUpdates = updates.filter((item) => {
      const expr = asRecord(item.Update).UpdateExpression;
      return typeof expr === "string" && expr.includes("ADD");
    });
    expect(addUpdates.length).toBe(updates.length);

    const countryUpdate = requireFound(
      updates.find((item) => {
        const names = asRecord(asRecord(item.Update).ExpressionAttributeValues);
        return names[":dimension"] === "country";
      }),
    );
    const countryKey = asRecord(asRecord(countryUpdate.Update).Key);
    expect(String(countryKey.pk)).toContain("breakdown#country#hour");
    expect(countryKey.sk).toBe("ZZ");
  });

  it("derives country from a mocked ip cache when api key present", async () => {
    const rows = [
      totalsRow({ hits: 10, cacheHits: 5 }),
      ipRow({ ip: "1.2.3.4", hits: 7 }),
      ipRow({ ip: "5.6.7.8", hits: 3 }),
    ];
    const { client } = makeAthena(rows);
    const { dynamo, sends: dynamoSends } = makeDynamo();
    const models = baseModels({
      isApplied: false,
      enrichMany: async () => ({
        "1.2.3.4": {
          pk: "ipinfo#1.2.3.4",
          sk: "ipinfo",
          ip: "1.2.3.4",
          countryCode: "US",
          fetchedAt: "x",
        },
        "5.6.7.8": {
          pk: "ipinfo#5.6.7.8",
          sk: "ipinfo",
          ip: "5.6.7.8",
          countryCode: "US",
          fetchedAt: "x",
        },
      }),
    });

    const result = await processHour({
      hourKey: "2026-02-14-09",
      models,
      athena: { client, ...athenaConfig },
      options: { topPaths: 100, hourlyTtlDays: 90, ipInfoApiKey: "key" },
      dynamo,
    });

    expect(result.status).toBe("applied");
    const items = transactItems(firstCommand(dynamoSends));
    const countryUpdate = requireFound(
      items
        .filter((item) => "Update" in item)
        .find(
          (item) =>
            asRecord(asRecord(item.Update).ExpressionAttributeValues)[":dimension"] === "country",
        ),
    );
    const key = asRecord(asRecord(countryUpdate.Update).Key);
    expect(key.sk).toBe("US");
    const vals = asRecord(asRecord(countryUpdate.Update).ExpressionAttributeValues);
    expect(vals[":hits"]).toBe(10);
  });

  it("chunks past 100 items: first transaction has marker + totals, follow-ups cover the rest", async () => {
    const pathRows = Array.from({ length: 150 }, (_unused, index) =>
      pathRow({ path: `/path-${index}`, hits: 150 - index }),
    );
    const rows = [totalsRow({ hits: 1000, cacheHits: 500 }), ...pathRows];
    const { client } = makeAthena(rows);
    const { dynamo, sends: dynamoSends } = makeDynamo();
    const models = baseModels({ isApplied: false });

    const result = await processHour({
      hourKey: "2026-02-14-09",
      models,
      athena: { client, ...athenaConfig },
      options: { topPaths: 200, hourlyTtlDays: 90 },
      dynamo,
    });

    expect(result.status).toBe("applied");
    expect(dynamoSends.length).toBeGreaterThan(1);

    const firstItems = transactItems(firstCommand(dynamoSends));
    expect(firstItems.some((item) => "Put" in item)).toBe(true);
    expect(firstItems.length).toBe(100);

    const allUpdates = dynamoSends.flatMap((command) =>
      transactItems(command).filter((item) => "Update" in item),
    );
    const breakdownUpdates = allUpdates.filter((item) => {
      const vals = asRecord(asRecord(item.Update).ExpressionAttributeValues);
      return vals[":dimension"] != null;
    });
    expect(breakdownUpdates.length).toBe(150);

    for (const command of dynamoSends) {
      expect(transactItems(command).length).toBeLessThanOrEqual(100);
    }
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") throw new Error("expected object");
  return Object.fromEntries(Object.entries(value));
}
