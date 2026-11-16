import { describe, expect, it } from "bun:test";

import { buildWatchHourBatchQuery, processWatchHourBatch } from "../src/watch.ts";

type Row = ReadonlyArray<string>;

const header = [
  "path_value",
  "hits",
  "bytes_sent",
  "cache_hits",
  "cache_misses",
  "cache_errors",
  "bytes_saved",
  "errors",
  "redirects",
];

function row(path: string, hits: number): Row {
  return [path, String(hits), String(hits * 100), String(hits), "0", "0", "0", "0", "0"];
}

function toAthenaRow(cells: Row): { Data: Array<{ VarCharValue: string }> } {
  return { Data: cells.map((cell) => ({ VarCharValue: cell })) };
}

function makeAthena(rows: Array<Row>) {
  const queries: Array<string> = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: { QueryString?: string } }) => {
      const name = command.constructor.name;
      if (name === "StartQueryExecutionCommand") {
        queries.push(command.input.QueryString ?? "");
        return { QueryExecutionId: "qid" };
      }
      if (name === "GetQueryExecutionCommand") {
        return { QueryExecution: { Status: { State: "SUCCEEDED" } } };
      }
      if (name === "GetQueryResultsCommand") {
        return { ResultSet: { Rows: [toAthenaRow(header), ...rows.map(toAthenaRow)] } };
      }
      throw new Error(`unexpected athena command ${name}`);
    },
  };
  return { client, queries };
}

interface AddCall {
  readonly matcher: string;
  readonly path?: string;
  readonly hits: number;
}

function makeModels({ applied = [] }: { applied?: Array<string> } = {}) {
  const adds: Array<AddCall> = [];
  const models = {
    watchStats: {
      buildAdd: (call: AddCall) => {
        adds.push(call);
        return {
          Update: {
            TableName: "t",
            Key: { pk: call.matcher, sk: "m" },
            UpdateExpression: "ADD #hits :hits",
          },
        };
      },
    },
    markers: {
      isApplied: async ({ periodKey }: { periodKey: string }) =>
        applied.some((matcher) => periodKey.startsWith(`${matcher}#`)),
      buildMarkerPut: ({ periodKey }: { periodKey: string }) => ({
        Put: { TableName: "t", Item: { pk: periodKey, sk: "applied" } },
      }),
    },
  };
  const dynamo = { send: async () => ({}) };
  return { models, adds, dynamo };
}

const athenaConfig = { database: "db", table: "t", workgroup: "wg" };

describe("buildWatchHourBatchQuery", () => {
  it("combines exact entries into one IN list and prefixes into LIKEs, grouped by raw uri", () => {
    const query = buildWatchHourBatchQuery({
      table: "cf",
      hourKey: "2026-05-14-09",
      entries: [
        { matcher: "/blog/a", mode: "exact" },
        { matcher: "/blog/b", mode: "exact" },
        { matcher: "/images/", mode: "group" },
        { matcher: "/docs/", mode: "split" },
      ],
    });

    expect(query).toContain(`year = '2026' AND month = '05' AND day = '14' AND hour = '09'`);
    expect(query).toContain("IN ('/blog/a', '/blog/b')");
    expect(query).toContain("cs_uri_stem LIKE '/images/%'");
    expect(query).toContain("cs_uri_stem LIKE '/docs/%'");
    expect(query).toContain("GROUP BY cs_uri_stem");
  });

  it("escapes single quotes in matchers", () => {
    const query = buildWatchHourBatchQuery({
      table: "cf",
      hourKey: "2026-05-14-09",
      entries: [{ matcher: "/it's", mode: "exact" }],
    });
    expect(query).toContain("'/it''s'");
  });
});

describe("processWatchHourBatch", () => {
  it("issues exactly one Athena query regardless of the number of entries", async () => {
    const { client, queries } = makeAthena([row("/blog/a", 3)]);
    const { models, dynamo } = makeModels();
    const entries = Array.from({ length: 60 }, (_, index) => ({
      matcher: `/blog/post-${index}`,
      mode: "exact" as const,
    }));

    const results = await processWatchHourBatch({
      hourKey: "2026-05-14-09",
      entries,
      models,
      athena: { client, ...athenaConfig },
      dynamo,
    });

    expect(queries.length).toBe(1);
    expect(results.length).toBe(60);
    expect(results.every((result) => result.status === "applied")).toBe(true);
  });

  it("assigns rows to exact, group and split entries in memory", async () => {
    const { client } = makeAthena([
      row("/blog/a", 3),
      row("/blog/a/", 2),
      row("/blog/b", 5),
      row("/images/x.png", 7),
      row("/images/y.png", 1),
    ]);
    const { models, adds, dynamo } = makeModels();

    const results = await processWatchHourBatch({
      hourKey: "2026-05-14-09",
      entries: [
        { matcher: "/blog/a", mode: "exact" },
        { matcher: "/images/", mode: "group" },
        { matcher: "/blog/", mode: "split" },
        { matcher: "/blog/missing", mode: "exact" },
      ],
      models,
      athena: { client, ...athenaConfig },
      dynamo,
    });

    expect(results.map((result) => [result.matcher, result.buckets])).toEqual([
      ["/blog/a", 1],
      ["/images/", 1],
      ["/blog/", 2],
      ["/blog/missing", 1],
    ]);

    const hitsFor = (matcher: string, path?: string) =>
      adds.find((add) => add.matcher === matcher && add.path === path)?.hits;
    expect(hitsFor("/blog/a")).toBe(5);
    expect(hitsFor("/images/")).toBe(8);
    expect(hitsFor("/blog/", "/blog/a")).toBe(5);
    expect(hitsFor("/blog/", "/blog/b")).toBe(5);
    expect(hitsFor("/blog/missing")).toBe(0);
  });

  it("skips applied entries and queries only for the rest", async () => {
    const { client, queries } = makeAthena([row("/blog/b", 4)]);
    const { models, adds, dynamo } = makeModels({ applied: ["/blog/a"] });

    const results = await processWatchHourBatch({
      hourKey: "2026-05-14-09",
      entries: [
        { matcher: "/blog/a", mode: "exact" },
        { matcher: "/blog/b", mode: "exact" },
      ],
      models,
      athena: { client, ...athenaConfig },
      dynamo,
    });

    expect(results.find((result) => result.matcher === "/blog/a")?.status).toBe("skipped");
    expect(queries.length).toBe(1);
    expect(queries[0]).not.toContain("/blog/a'");
    expect(adds.map((add) => add.matcher)).toEqual(["/blog/b"]);
  });

  it("does not query Athena when every entry is already applied", async () => {
    const { client, queries } = makeAthena([]);
    const { models, dynamo } = makeModels({ applied: ["/blog/a"] });

    const results = await processWatchHourBatch({
      hourKey: "2026-05-14-09",
      entries: [{ matcher: "/blog/a", mode: "exact" }],
      models,
      athena: { client, ...athenaConfig },
      dynamo,
    });

    expect(queries.length).toBe(0);
    expect(results).toEqual([{ matcher: "/blog/a", status: "skipped", buckets: 0 }]);
  });

  it("reports a failing write as failed without stopping other entries", async () => {
    const { client } = makeAthena([row("/blog/a", 1), row("/blog/b", 1)]);
    const { models, dynamo } = makeModels();
    let call = 0;
    const flakyDynamo = {
      send: async () => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return {};
      },
    };

    const results = await processWatchHourBatch({
      hourKey: "2026-05-14-09",
      entries: [
        { matcher: "/blog/a", mode: "exact" },
        { matcher: "/blog/b", mode: "exact" },
      ],
      models,
      athena: { client, ...athenaConfig },
      dynamo: flakyDynamo,
    });

    expect(dynamo).toBeDefined();
    expect(results.map((result) => result.status)).toEqual(["failed", "applied"]);
  });
});
