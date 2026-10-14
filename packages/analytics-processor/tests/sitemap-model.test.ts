import { describe, expect, it } from "bun:test";

import { SitemapUrlStats } from "../src/sitemap.ts";

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

describe("SitemapUrlStats.buildAdd", () => {
  it("adds the day and month-total counters and sets the metadata", () => {
    const stats = new SitemapUrlStats({ dynamo: makeDynamo().dynamo, tableName: "test-table" });

    const item = stats.buildAdd({
      path: "/blog/x",
      month: "2026-05",
      dayAttr: "d14",
      hits: 7,
    });

    const members = item.Update;
    if (members == null) throw new Error("expected an Update member");

    const expression = members.UpdateExpression;
    if (typeof expression !== "string") throw new Error("expected string expression");
    expect(expression).toContain("SET #path = :path, #month = :month, #updatedAt = :now");
    expect(expression).toContain("ADD #hits :hits, #day :hits");

    const names = asRecord(members.ExpressionAttributeNames);
    expect(names["#day"]).toBe("d14");
    expect(names["#hits"]).toBe("hits");

    const values = asRecord(members.ExpressionAttributeValues);
    expect(values[":hits"]).toBe(7);
    expect(values[":path"]).toBe("/blog/x");
    expect(values[":month"]).toBe("2026-05");
    expect(typeof values[":now"]).toBe("number");

    expect(members.Key).toEqual({ pk: "sitemapurl#/blog/x", sk: "2026-05" });
    expect(members.TableName).toBe("test-table");
  });
});

describe("SitemapUrlStats.buildOverwrite", () => {
  it("sets the metadata plus only the present day attributes with SET", () => {
    const stats = new SitemapUrlStats({ dynamo: makeDynamo().dynamo, tableName: "test-table" });

    const members = stats.buildOverwrite({
      path: "/blog/x",
      month: "2026-05",
      days: { "01": 5, "14": 12 },
      hits: 17,
    });

    const expression = members.UpdateExpression;
    if (typeof expression !== "string") throw new Error("expected string expression");
    expect(expression.startsWith("SET ")).toBe(true);
    expect(expression).toContain("#hits = :hits");
    expect(expression).toContain("#d01 = :d01");
    expect(expression).toContain("#d14 = :d14");
    expect(expression).not.toContain(":d02");
    expect(expression).not.toContain("ADD");

    const names = asRecord(members.ExpressionAttributeNames);
    expect(names["#d01"]).toBe("d01");
    expect(names["#d14"]).toBe("d14");

    const values = asRecord(members.ExpressionAttributeValues);
    expect(values[":d01"]).toBe(5);
    expect(values[":d14"]).toBe(12);
    expect(values[":hits"]).toBe(17);

    expect(members.Key).toEqual({ pk: "sitemapurl#/blog/x", sk: "2026-05" });
  });
});

describe("SitemapUrlStats.overwriteMany", () => {
  it("sends one UpdateCommand per stat", async () => {
    const { dynamo, recorded } = makeDynamo();
    const stats = new SitemapUrlStats({ dynamo, tableName: "test-table" });

    await stats.overwriteMany([
      { path: "/a", month: "2026-05", days: { "01": 1 }, hits: 1 },
      { path: "/b", month: "2026-05", days: { "02": 2 }, hits: 2 },
    ]);

    expect(recorded.length).toBe(2);
    expect(recorded.every((command) => command.name === "UpdateCommand")).toBe(true);
  });
});

const storedItem = {
  pk: "sitemapurl#/blog/x",
  sk: "2026-05",
  path: "/blog/x",
  month: "2026-05",
  hits: 12,
  updatedAt: 1_700_000_000_000,
  d01: 3,
  d05: 9,
};

describe("SitemapUrlStats.getForMonth", () => {
  it("reshapes dNN attributes into a days record on read", async () => {
    const { dynamo, recorded } = makeDynamo({ Items: [storedItem] });
    const stats = new SitemapUrlStats({
      dynamo,
      tableName: "test-table",
      reverseIndexName: "reverse-index",
    });

    const result = await stats.getForMonth({ month: "2026-05" });

    expect(result.length).toBe(1);
    expect(result[0]?.days).toEqual({ "01": 3, "05": 9 });
    expect(result[0]?.hits).toBe(12);
    expect(result[0]?.path).toBe("/blog/x");
    expect(result[0]?.month).toBe("2026-05");

    const command = recorded[0];
    if (command == null) throw new Error("no command");
    expect(command.input.IndexName).toBe("reverse-index");
    expect(command.input.KeyConditionExpression).toBe("#sk = :month");
    expect(asRecord(command.input.ExpressionAttributeValues)[":month"]).toBe("2026-05");
  });

  it("throws without a reverseIndexName", async () => {
    const { dynamo } = makeDynamo({ Items: [] });
    const stats = new SitemapUrlStats({ dynamo, tableName: "test-table" });

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

describe("SitemapUrlStats.getForUrl", () => {
  it("sends a Query with the BETWEEN key condition and reshapes days", async () => {
    const { dynamo, recorded } = makeDynamo({ Items: [storedItem] });
    const stats = new SitemapUrlStats({ dynamo, tableName: "test-table" });

    const result = await stats.getForUrl({
      path: "/blog/x",
      startMonth: "2025-01",
      endMonth: "2026-12",
    });

    expect(result[0]?.days).toEqual({ "01": 3, "05": 9 });

    const command = recorded[0];
    if (command == null) throw new Error("no command");
    expect(command.name).toBe("QueryCommand");
    expect(command.input.KeyConditionExpression).toBe("#pk = :pk AND #sk BETWEEN :start AND :end");
    const values = asRecord(command.input.ExpressionAttributeValues);
    expect(values[":pk"]).toBe("sitemapurl#/blog/x");
    expect(values[":start"]).toBe("2025-01");
    expect(values[":end"]).toBe("2026-12");
  });
});
