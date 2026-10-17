import { describe, expect, it } from "bun:test";

import { watchStatsPk, WatchStats } from "../src/watch.ts";

interface RecordedCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function makeDynamo(result: Record<string, unknown> = {}) {
  const recorded: Array<RecordedCommand> = [];
  const dynamo = {
    send: async (command: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }): Promise<Record<string, unknown>> => {
      recorded.push({ name: command.constructor.name, input: command.input });
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

const fullCounts = {
  hits: 7,
  bytesSent: 1024,
  cacheHits: 5,
  cacheMisses: 2,
  cacheErrors: 1,
  bytesSaved: 800,
  errors: 3,
  redirects: 4,
};

describe("watchStatsPk", () => {
  it("maps exact and group modes to a single bucket", () => {
    expect(watchStatsPk({ matcher: "/blog", mode: "exact" })).toBe("watch#/blog");
    expect(watchStatsPk({ matcher: "/blog", mode: "group" })).toBe("watch#/blog");
  });

  it("fans split mode out to one bucket per path", () => {
    expect(watchStatsPk({ matcher: "/blog", mode: "split", path: "/blog/x" })).toBe(
      "watch#/blog#/blog/x",
    );
  });

  it("throws for split mode without a path", () => {
    expect(() => watchStatsPk({ matcher: "/blog", mode: "split" })).toThrow();
  });
});

describe("WatchStats.buildAdd", () => {
  it("sets metadata and ADDs every additive metric plus the day attr", () => {
    const stats = new WatchStats({ dynamo: makeDynamo().dynamo, tableName: "test-table" });

    const item = stats.buildAdd({
      matcher: "/blog",
      mode: "group",
      month: "2026-05",
      dayAttr: "d14",
      ...fullCounts,
    });

    const members = item.Update;
    if (members == null) throw new Error("expected an Update member");

    const expression = members.UpdateExpression;
    if (typeof expression !== "string") throw new Error("expected string expression");
    expect(expression).toContain(
      "SET #matcher = :matcher, #mode = :mode, #month = :month, #updatedAt = :now",
    );
    expect(expression).toContain("ADD #hits :hits, #day :hits");
    expect(expression).toContain("#bytesSent :bytesSent");
    expect(expression).toContain("#cacheHits :cacheHits");
    expect(expression).toContain("#cacheMisses :cacheMisses");
    expect(expression).toContain("#cacheErrors :cacheErrors");
    expect(expression).toContain("#bytesSaved :bytesSaved");
    expect(expression).toContain("#errors :errors");
    expect(expression).toContain("#redirects :redirects");

    const names = asRecord(members.ExpressionAttributeNames);
    expect(names["#day"]).toBe("d14");
    expect(names["#hits"]).toBe("hits");
    expect(names["#bytesSent"]).toBe("bytesSent");

    const values = asRecord(members.ExpressionAttributeValues);
    expect(values[":hits"]).toBe(7);
    expect(values[":bytesSent"]).toBe(1024);
    expect(values[":cacheErrors"]).toBe(1);
    expect(values[":redirects"]).toBe(4);
    expect(values[":matcher"]).toBe("/blog");
    expect(values[":mode"]).toBe("group");
    expect(values[":month"]).toBe("2026-05");
    expect(typeof values[":now"]).toBe("number");

    expect(members.Key).toEqual({ pk: "watch#/blog", sk: "2026-05" });
    expect(members.TableName).toBe("test-table");
  });

  it("keys split buckets per path", () => {
    const stats = new WatchStats({ dynamo: makeDynamo().dynamo, tableName: "test-table" });

    const item = stats.buildAdd({
      matcher: "/blog",
      mode: "split",
      path: "/blog/x",
      month: "2026-05",
      dayAttr: "d14",
      ...fullCounts,
    });

    expect(item.Update?.Key).toEqual({ pk: "watch#/blog#/blog/x", sk: "2026-05" });
  });
});

describe("WatchStats.buildOverwrite", () => {
  it("SETs all scalars plus only the present day attributes, deterministically", () => {
    const stats = new WatchStats({ dynamo: makeDynamo().dynamo, tableName: "test-table" });

    const first = stats.buildOverwrite({
      matcher: "/blog",
      mode: "group",
      month: "2026-05",
      days: { "01": 5, "14": 12 },
      ...fullCounts,
    });
    const second = stats.buildOverwrite({
      matcher: "/blog",
      mode: "group",
      month: "2026-05",
      days: { "01": 5, "14": 12 },
      ...fullCounts,
    });

    const expression = first.UpdateExpression;
    if (typeof expression !== "string") throw new Error("expected string expression");
    expect(expression.startsWith("SET ")).toBe(true);
    expect(expression).toContain("#hits = :hits");
    expect(expression).toContain("#bytesSent = :bytesSent");
    expect(expression).toContain("#redirects = :redirects");
    expect(expression).toContain("#d01 = :d01");
    expect(expression).toContain("#d14 = :d14");
    expect(expression).not.toContain(":d02");
    expect(expression).not.toContain("ADD");

    expect(second.UpdateExpression).toBe(expression);
    expect(asRecord(second.ExpressionAttributeNames)).toEqual(
      asRecord(first.ExpressionAttributeNames),
    );

    const names = asRecord(first.ExpressionAttributeNames);
    expect(names["#d01"]).toBe("d01");
    expect(names["#d14"]).toBe("d14");

    const values = asRecord(first.ExpressionAttributeValues);
    expect(values[":d01"]).toBe(5);
    expect(values[":d14"]).toBe(12);
    expect(values[":hits"]).toBe(7);
    expect(values[":bytesSaved"]).toBe(800);

    expect(first.Key).toEqual({ pk: "watch#/blog", sk: "2026-05" });
  });
});

describe("WatchStats.overwriteMany", () => {
  it("sends one UpdateCommand per stat", async () => {
    const { dynamo, recorded } = makeDynamo();
    const stats = new WatchStats({ dynamo, tableName: "test-table" });

    await stats.overwriteMany([
      { matcher: "/a", mode: "group", month: "2026-05", days: { "01": 1 }, ...fullCounts },
      { matcher: "/b", mode: "exact", month: "2026-05", days: { "02": 2 }, ...fullCounts },
    ]);

    expect(recorded.length).toBe(2);
    expect(recorded.every((command) => command.name === "UpdateCommand")).toBe(true);
  });
});

const storedItem = {
  pk: "watch#/blog",
  sk: "2026-05",
  matcher: "/blog",
  mode: "group",
  month: "2026-05",
  hits: 12,
  bytesSent: 2048,
  cacheHits: 8,
  cacheMisses: 3,
  cacheErrors: 1,
  bytesSaved: 1500,
  errors: 2,
  redirects: 5,
  updatedAt: 1_700_000_000_000,
  d01: 3,
  d15: 9,
};

describe("WatchStats.parseOne via getForMonth", () => {
  it("reshapes dNN attributes into a days record and preserves scalars", async () => {
    const { dynamo, recorded } = makeDynamo({ Items: [storedItem] });
    const stats = new WatchStats({
      dynamo,
      tableName: "test-table",
      reverseIndexName: "reverse-index",
    });

    const result = await stats.getForMonth({ month: "2026-05" });

    expect(result.length).toBe(1);
    expect(result[0]?.days).toEqual({ "01": 3, "15": 9 });
    expect(result[0]?.hits).toBe(12);
    expect(result[0]?.bytesSent).toBe(2048);
    expect(result[0]?.cacheHits).toBe(8);
    expect(result[0]?.redirects).toBe(5);
    expect(result[0]?.matcher).toBe("/blog");
    expect(result[0]?.mode).toBe("group");
    expect(result[0]?.month).toBe("2026-05");

    const command = recorded[0];
    if (command == null) throw new Error("no command");
    expect(command.input.IndexName).toBe("reverse-index");
    expect(command.input.KeyConditionExpression).toBe(
      "#sk = :month AND begins_with(#pk, :pkPrefix)",
    );
    expect(asRecord(command.input.ExpressionAttributeValues)[":month"]).toBe("2026-05");
    expect(asRecord(command.input.ExpressionAttributeValues)[":pkPrefix"]).toBe("watch#");
  });

  it("throws without a reverseIndexName", async () => {
    const { dynamo } = makeDynamo({ Items: [] });
    const stats = new WatchStats({ dynamo, tableName: "test-table" });

    let caught: unknown;
    try {
      await stats.getForMonth({ month: "2026-05" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) throw new Error("expected an Error");
    expect(caught.message).toBe("getForMonth requires a reverseIndexName");
  });
});

describe("WatchStats.getForEntry", () => {
  it("sends a Query with the BETWEEN key condition and reshapes days", async () => {
    const { dynamo, recorded } = makeDynamo({ Items: [storedItem] });
    const stats = new WatchStats({ dynamo, tableName: "test-table" });

    const result = await stats.getForEntry({
      matcher: "/blog",
      mode: "group",
      startMonth: "2025-01",
      endMonth: "2026-12",
    });

    expect(result[0]?.days).toEqual({ "01": 3, "15": 9 });

    const command = recorded[0];
    if (command == null) throw new Error("no command");
    expect(command.name).toBe("QueryCommand");
    expect(command.input.KeyConditionExpression).toBe("#pk = :pk AND #sk BETWEEN :start AND :end");
    const values = asRecord(command.input.ExpressionAttributeValues);
    expect(values[":pk"]).toBe("watch#/blog");
    expect(values[":start"]).toBe("2025-01");
    expect(values[":end"]).toBe("2026-12");
  });

  it("keys split buckets per path", async () => {
    const { dynamo, recorded } = makeDynamo({ Items: [] });
    const stats = new WatchStats({ dynamo, tableName: "test-table" });

    await stats.getForEntry({
      matcher: "/blog",
      mode: "split",
      path: "/blog/x",
      startMonth: "2025-01",
      endMonth: "2026-12",
    });

    const command = recorded[0];
    if (command == null) throw new Error("no command");
    expect(asRecord(command.input.ExpressionAttributeValues)[":pk"]).toBe("watch#/blog#/blog/x");
  });
});
