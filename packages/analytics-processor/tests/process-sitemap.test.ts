import { afterEach, describe, expect, it } from "bun:test";

import {
  fetchSitemapPaths,
  processSitemapHour,
  processSitemapMonth,
  sitemapUserAgent,
} from "../src/sitemap.ts";

type Cell = { readonly VarCharValue?: string };
type AthenaRow = { readonly Data: Array<Cell> };

const headerRow: AthenaRow = {
  Data: [{ VarCharValue: "path_value" }, { VarCharValue: "hits" }],
};

function dataRow(values: Array<string | undefined>): AthenaRow {
  return { Data: values.map((value) => ({ VarCharValue: value })) };
}

function makeAthena(rows: Array<AthenaRow>) {
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
        return { ResultSet: { Rows: [headerRow, ...rows] } };
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

function makeMarkers({ alreadyApplied = false }: { alreadyApplied?: boolean } = {}) {
  return {
    isApplied: async ({ periodKey }: { periodKey: string }): Promise<boolean> => {
      void periodKey;
      return alreadyApplied;
    },
    buildMarkerPut: ({ periodKey }: { periodKey: string }) => ({
      Put: {
        TableName: "test-table",
        Item: { pk: `applied#sitemap#${periodKey}`, sk: "applied" },
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      },
    }),
  };
}

const sitemapUrlStats = {
  buildAdd: ({
    path,
    month,
    dayAttr,
    hits,
  }: {
    path: string;
    month: string;
    dayAttr: string;
    hits: number;
  }) => ({
    Update: {
      TableName: "test-table",
      Key: { pk: `sitemapurl#${path}`, sk: month },
      UpdateExpression: "SET #updatedAt = :now ADD #hits :hits, #day :hits",
      ExpressionAttributeNames: { "#updatedAt": "updatedAt", "#hits": "hits", "#day": dayAttr },
      ExpressionAttributeValues: { ":now": Date.now(), ":hits": hits },
    },
  }),
};

describe("processSitemapHour", () => {
  it("writes a marker plus one add per path in a single transaction", async () => {
    const rows = [dataRow(["/blog", "5"]), dataRow(["/about", "7"])];
    const { client } = makeAthena(rows);
    const { dynamo, transactions } = makeDynamo();

    const result = await processSitemapHour({
      hourKey: "2026-05-14-09",
      paths: ["/blog", "/about"],
      models: { sitemapUrlStats, markers: makeMarkers() },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
      dynamo,
    });

    expect(result).toEqual({ status: "applied", urls: 2 });
    expect(transactions.length).toBe(1);

    const chunk = transactions[0];
    if (chunk == null) throw new Error("expected a transaction");
    expect(chunk.length).toBe(3);

    const markerPut = chunk.find((item) => item.Put != null);
    expect(markerPut?.Put?.Item?.pk).toBe("applied#sitemap#2026-05-14-09");

    const updateKeys = chunk
      .filter((item) => item.Update != null)
      .map((item) => item.Update?.Key?.pk);
    expect(updateKeys).toContain("sitemapurl#/blog");
    expect(updateKeys).toContain("sitemapurl#/about");

    for (const item of chunk) {
      if (item.Update == null) continue;
      expect(item.Update.Key?.sk).toBe("2026-05");
    }
  });

  it("skips without calling Athena when the hour is already applied", async () => {
    const { client, names } = makeAthena([]);
    const { dynamo, transactions } = makeDynamo();

    const result = await processSitemapHour({
      hourKey: "2026-05-14-09",
      paths: ["/blog"],
      models: { sitemapUrlStats, markers: makeMarkers({ alreadyApplied: true }) },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
      dynamo,
    });

    expect(result).toEqual({ status: "skipped", urls: 0 });
    expect(names.length).toBe(0);
    expect(transactions.length).toBe(0);
  });

  it("writes only the marker and reports zero urls when no path matched", async () => {
    const { client } = makeAthena([]);
    const { dynamo, transactions } = makeDynamo();

    const result = await processSitemapHour({
      hourKey: "2026-05-14-09",
      paths: ["/blog"],
      models: { sitemapUrlStats, markers: makeMarkers() },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
      dynamo,
    });

    expect(result).toEqual({ status: "applied", urls: 0 });
    expect(transactions.length).toBe(1);
    expect(transactions[0]?.length).toBe(1);
  });
});

describe("processSitemapMonth", () => {
  const monthlyHeader: AthenaRow = {
    Data: [{ VarCharValue: "day_value" }, { VarCharValue: "path_value" }, { VarCharValue: "hits" }],
  };

  function makeMonthlyAthena(rows: Array<AthenaRow>) {
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
          return { ResultSet: { Rows: [monthlyHeader, ...rows] } };
        }
        throw new Error(`unexpected athena command ${name}`);
      },
    };
    return { client, names };
  }

  it("reshapes day+path rows and overwrites each path's month item", async () => {
    const rows = [
      dataRow(["1", "/blog", "5"]),
      dataRow(["2", "/blog", "3"]),
      dataRow(["1", "/about", "7"]),
    ];
    const { client } = makeMonthlyAthena(rows);
    const captured: Array<
      Array<{ path: string; month: string; days: Record<string, number>; hits: number }>
    > = [];
    const sitemapUrlStatsMonthly = {
      overwriteMany: async (
        stats: Array<{ path: string; month: string; days: Record<string, number>; hits: number }>,
      ): Promise<void> => {
        captured.push(stats);
      },
    };

    const result = await processSitemapMonth({
      monthKey: "2026-05",
      paths: ["/blog", "/about"],
      models: { sitemapUrlStats: sitemapUrlStatsMonthly },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
    });

    expect(result).toEqual({ urls: 2 });
    const overwritten = captured[0];
    if (overwritten == null) throw new Error("expected an overwrite call");

    const blog = overwritten.find((stat) => stat.path === "/blog");
    const about = overwritten.find((stat) => stat.path === "/about");
    expect(blog).toEqual({ path: "/blog", month: "2026-05", days: { "01": 5, "02": 3 }, hits: 8 });
    expect(about).toEqual({ path: "/about", month: "2026-05", days: { "01": 7 }, hits: 7 });
  });

  it("returns { urls: 0 } and never calls Athena for an empty path set", async () => {
    const { client, names } = makeMonthlyAthena([]);
    let overwriteCalls = 0;
    const sitemapUrlStatsMonthly = {
      overwriteMany: async (): Promise<void> => {
        overwriteCalls += 1;
      },
    };

    const result = await processSitemapMonth({
      monthKey: "2026-05",
      paths: [],
      models: { sitemapUrlStats: sitemapUrlStatsMonthly },
      athena: { client, database: "db", table: "t", workgroup: "wg" },
    });

    expect(result).toEqual({ urls: 0 });
    expect(names.length).toBe(0);
    expect(overwriteCalls).toBe(0);
  });
});

describe("fetchSitemapPaths", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches, parses, and returns the normalized paths", async () => {
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset>`,
      `<url><loc>https://example.com/</loc></url>`,
      `<url><loc>https://example.com/blog</loc></url>`,
      `<url><loc>https://example.com/blog/</loc></url>`,
      `</urlset>`,
    ].join("");

    const requests: Array<RequestInit | undefined> = [];
    const fetchStub: typeof globalThis.fetch = Object.assign(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requests.push(init);
        return new Response(xml, { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );
    globalThis.fetch = fetchStub;

    const paths = await fetchSitemapPaths("https://example.com/sitemap.xml");

    expect(paths).toEqual(["/", "/blog"]);

    const headers = new Headers(requests[0]?.headers);
    expect(headers.get("user-agent")).toBe(sitemapUserAgent);
  });
});
