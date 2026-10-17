import { describe, expect, it } from "bun:test";

import { processWatchHour, processWatchMonth, watchMarkerPeriodKey } from "../src/watch.ts";

type Cell = { readonly VarCharValue?: string };
type AthenaRow = { readonly Data: Array<Cell> };

const hourlyHeader: AthenaRow = {
  Data: [
    { VarCharValue: "hits" },
    { VarCharValue: "bytes_sent" },
    { VarCharValue: "cache_hits" },
    { VarCharValue: "cache_misses" },
    { VarCharValue: "cache_errors" },
    { VarCharValue: "bytes_saved" },
    { VarCharValue: "errors" },
    { VarCharValue: "redirects" },
  ],
};

const splitHourlyHeader: AthenaRow = {
  Data: [{ VarCharValue: "path_value" }, ...hourlyHeader.Data],
};

function dataRow(values: Array<string | undefined>): AthenaRow {
  return { Data: values.map((value) => ({ VarCharValue: value })) };
}

function makeAthena({ header, rows }: { header: AthenaRow; rows: Array<AthenaRow> }) {
  const names: Array<string> = [];
  const client = {
    send: async (command: { constructor: { name: string } }) => {
      const name = command.constructor.name;
      names.push(name);
      if (name === "StartQueryExecutionCommand") return { QueryExecutionId: "qid-1" };
      if (name === "GetQueryExecutionCommand") {
        return { QueryExecution: { Status: { State: "SUCCEEDED" } } };
      }
      if (name === "GetQueryResultsCommand") {
        return { ResultSet: { Rows: [header, ...rows] } };
      }
      throw new Error(`unexpected athena command ${name}`);
    },
  };
  return { client, names };
}

interface TransactItemLike {
  readonly Update?: { readonly Key?: Record<string, unknown> };
  readonly Put?: { readonly Item?: Record<string, unknown> };
}

function makeDynamo() {
  const transactions: Array<Array<TransactItemLike>> = [];
  const dynamo = {
    send: async (command: {
      constructor: { name: string };
      input: { TransactItems?: Array<TransactItemLike> };
    }): Promise<Record<string, unknown>> => {
      const name = command.constructor.name;
      if (name === "TransactWriteCommand") {
        transactions.push(command.input.TransactItems ?? []);
        return {};
      }
      throw new Error(`unexpected dynamo command ${name}`);
    },
  };
  return { dynamo, transactions };
}

interface BuildAddCall {
  readonly matcher: string;
  readonly mode: string;
  readonly path?: string;
  readonly month: string;
  readonly dayAttr: string;
  readonly hits: number;
  readonly bytesSent: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
  readonly bytesSaved: number;
  readonly errors: number;
  readonly redirects: number;
}

function makeWatchStats() {
  const calls: Array<BuildAddCall> = [];
  const watchStats = {
    buildAdd: (call: BuildAddCall) => {
      calls.push(call);
      return {
        Update: {
          TableName: "test-table",
          Key: { pk: `watch#${call.matcher}`, sk: call.month },
          UpdateExpression: "SET #updatedAt = :now ADD #hits :hits",
          ExpressionAttributeNames: { "#updatedAt": "updatedAt", "#hits": "hits" },
          ExpressionAttributeValues: { ":now": Date.now(), ":hits": call.hits },
        },
      };
    },
  };
  return { watchStats, calls };
}

function makeMarkers({ alreadyApplied = false }: { alreadyApplied?: boolean } = {}) {
  const checked: Array<{ grain: string; periodKey: string }> = [];
  const markers = {
    isApplied: async ({
      grain,
      periodKey,
    }: {
      grain: string;
      periodKey: string;
    }): Promise<boolean> => {
      checked.push({ grain, periodKey });
      return alreadyApplied;
    },
    buildMarkerPut: ({ periodKey }: { periodKey: string }) => ({
      Put: {
        TableName: "test-table",
        Item: { pk: `applied#watch#${periodKey}`, sk: "applied" },
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      },
    }),
  };
  return { markers, checked };
}

describe("processWatchHour", () => {
  it("writes a marker plus one add per bucket with the right month/dayAttr", async () => {
    const { client } = makeAthena({
      header: splitHourlyHeader,
      rows: [
        dataRow(["/blog/a", "4", "800", "2", "2", "0", "500", "0", "0"]),
        dataRow(["/blog/b", "6", "1200", "4", "1", "1", "700", "1", "0"]),
      ],
    });
    const { dynamo, transactions } = makeDynamo();
    const { watchStats, calls } = makeWatchStats();
    const { markers } = makeMarkers();

    const result = await processWatchHour({
      hourKey: "2026-05-14-09",
      entry: { matcher: "/blog/", mode: "split" },
      models: { watchStats, markers },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
      dynamo,
    });

    expect(result).toEqual({ status: "applied", buckets: 2 });
    expect(transactions.length).toBe(1);

    const chunk = transactions[0];
    if (chunk == null) throw new Error("expected a transaction");
    expect(chunk.length).toBe(3);

    const markerPut = chunk.find((item) => item.Put != null);
    expect(markerPut?.Put?.Item?.pk).toBe("applied#watch#/blog/#2026-05-14-09");

    expect(calls.map((call) => call.path)).toEqual(["/blog/a", "/blog/b"]);
    for (const call of calls) {
      expect(call.matcher).toBe("/blog/");
      expect(call.mode).toBe("split");
      expect(call.month).toBe("2026-05");
      expect(call.dayAttr).toBe("d14");
    }
    expect(calls[1]).toMatchObject({
      hits: 6,
      bytesSent: 1200,
      cacheHits: 4,
      cacheMisses: 1,
      cacheErrors: 1,
      bytesSaved: 700,
      errors: 1,
      redirects: 0,
    });
  });

  it("skips without calling Athena when the hour is already applied", async () => {
    const { client, names } = makeAthena({ header: hourlyHeader, rows: [] });
    const { dynamo, transactions } = makeDynamo();
    const { watchStats, calls } = makeWatchStats();
    const { markers, checked } = makeMarkers({ alreadyApplied: true });

    const result = await processWatchHour({
      hourKey: "2026-05-14-09",
      entry: { matcher: "/blog", mode: "exact" },
      models: { watchStats, markers },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
      dynamo,
    });

    expect(result).toEqual({ status: "skipped", buckets: 0 });
    expect(names.length).toBe(0);
    expect(transactions.length).toBe(0);
    expect(calls.length).toBe(0);
    expect(checked[0]).toEqual({ grain: "watch", periodKey: "/blog#2026-05-14-09" });
  });

  it("uses a per-entry per-hour marker periodKey so distinct entries do not collide", () => {
    expect(watchMarkerPeriodKey({ matcher: "/blog", hourKey: "2026-05-14-09" })).toBe(
      "/blog#2026-05-14-09",
    );
    expect(watchMarkerPeriodKey({ matcher: "/docs", hourKey: "2026-05-14-09" })).not.toBe(
      watchMarkerPeriodKey({ matcher: "/blog", hourKey: "2026-05-14-09" }),
    );
  });

  it("writes only the marker and reports zero buckets when nothing matched", async () => {
    const { client } = makeAthena({ header: hourlyHeader, rows: [] });
    const { dynamo, transactions } = makeDynamo();
    const { watchStats } = makeWatchStats();
    const { markers } = makeMarkers();

    const result = await processWatchHour({
      hourKey: "2026-05-14-09",
      entry: { matcher: "/blog", mode: "exact" },
      models: { watchStats, markers },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
      dynamo,
    });

    expect(result).toEqual({ status: "applied", buckets: 0 });
    expect(transactions.length).toBe(1);
    expect(transactions[0]?.length).toBe(1);
  });
});

describe("processWatchMonth", () => {
  const monthlyHeader: AthenaRow = {
    Data: [{ VarCharValue: "day_value" }, ...hourlyHeader.Data],
  };

  it("overwrites each bucket's month item via overwriteMany", async () => {
    const { client } = makeAthena({
      header: monthlyHeader,
      rows: [
        dataRow(["1", "5", "500", "3", "1", "1", "300", "0", "0"]),
        dataRow(["2", "3", "300", "2", "1", "0", "200", "1", "1"]),
      ],
    });
    const captured: Array<Array<{ matcher: string; month: string; days: Record<string, number> }>> =
      [];
    const watchStats = {
      overwriteMany: async (
        stats: Array<{ matcher: string; month: string; days: Record<string, number> }>,
      ): Promise<void> => {
        captured.push(stats);
      },
    };

    const result = await processWatchMonth({
      monthKey: "2026-05",
      entry: { matcher: "/blog", mode: "exact" },
      models: { watchStats },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
    });

    expect(result).toEqual({ buckets: 1 });
    const overwritten = captured[0];
    if (overwritten == null) throw new Error("expected an overwrite call");
    expect(overwritten.length).toBe(1);
    expect(overwritten[0]).toMatchObject({
      matcher: "/blog",
      month: "2026-05",
      days: { "01": 5, "02": 3 },
    });
  });
});
