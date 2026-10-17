import { describe, expect, it } from "bun:test";

import * as v from "valibot";

import { Config } from "../src/config.ts";
import { watchConfigKey, watchEntrySchema } from "../src/watch.ts";

interface Sent {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("expected an object");
  return value;
}

function keyOf(input: Record<string, unknown>): string {
  const key = asRecord(input.Key);
  return `${String(key.pk)}|${String(key.sk)}`;
}

function makeWatchDynamo() {
  const sends: Array<Sent> = [];
  const store: Record<string, Record<string, unknown>> = {};

  const dynamo = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sends.push({ name: command.constructor.name, input: command.input });
      const name = command.constructor.name;

      if (name === "UpdateCommand") {
        const id = keyOf(command.input);
        const key = asRecord(command.input.Key);
        const values = asRecord(command.input.ExpressionAttributeValues);
        const existing = store[id] ?? { pk: key.pk, sk: key.sk };
        const next: Record<string, unknown> = { ...existing };

        if (values[":matcher"] !== undefined) next.matcher = values[":matcher"];
        if (values[":mode"] !== undefined) next.mode = values[":mode"];
        if (values[":source"] !== undefined) next.source = values[":source"];
        if (values[":status"] !== undefined) next.status = values[":status"];
        if (values[":label"] !== undefined) next.label = values[":label"];
        if (values[":now"] !== undefined && next.firstSeen === undefined) {
          next.firstSeen = values[":now"];
        }
        store[id] = next;
        return {};
      }

      if (name === "DeleteCommand") {
        delete store[keyOf(command.input)];
        return {};
      }

      if (name === "QueryCommand") {
        return { Items: Object.values(store) };
      }

      return {};
    },
  };

  return { dynamo, sends, store };
}

describe("Config.upsertWatch + listWatch", () => {
  it("round-trips a watch config row through the reverse index", async () => {
    const { dynamo, sends } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    await config.upsertWatch({
      matcher: "/blog",
      mode: "group",
      source: "manual",
      label: "Blog",
    });

    const entries = await config.listWatch();
    expect(entries.length).toBe(1);
    expect(entries[0]?.matcher).toBe("/blog");
    expect(entries[0]?.mode).toBe("group");
    expect(entries[0]?.source).toBe("manual");
    expect(entries[0]?.status).toBe("active");
    expect(entries[0]?.label).toBe("Blog");
    expect(typeof entries[0]?.firstSeen).toBe("string");

    const query = sends.find((sent) => sent.name === "QueryCommand");
    expect(query?.input.IndexName).toBe("reverse-index");
    expect(query?.input.KeyConditionExpression).toBe("#sk = :sk AND begins_with(#pk, :pkPrefix)");
    const values = asRecord(query?.input.ExpressionAttributeValues);
    expect(values[":sk"]).toBe("config");
    expect(values[":pkPrefix"]).toBe("watch#");
  });

  it("writes the config row at pk=watch#<matcher>, sk=config", async () => {
    const { dynamo, sends } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    await config.upsertWatch({ matcher: "/blog", mode: "group", source: "manual" });

    const update = sends.find((sent) => sent.name === "UpdateCommand");
    expect(update?.input.Key).toEqual({ pk: "watch#/blog", sk: "config" });
    expect(watchConfigKey({ matcher: "/blog" })).toEqual({ pk: "watch#/blog", sk: "config" });
  });

  it("throws from listWatch without a reverseIndexName", async () => {
    const { dynamo } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t" });

    let caught: unknown;
    try {
      await config.listWatch();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) throw new Error("expected an Error");
    expect(caught.message).toBe("listWatch requires a reverseIndexName");
  });
});

describe("Config.setWatchStatus", () => {
  it("transitions active -> stopped -> active, preserving firstSeen", async () => {
    const { dynamo } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    await config.upsertWatch({ matcher: "/blog", mode: "group", source: "sitemap" });
    const firstSeen = (await config.listWatch())[0]?.firstSeen;
    expect(typeof firstSeen).toBe("string");

    await config.setWatchStatus({ matcher: "/blog", status: "stopped" });
    expect((await config.listWatch())[0]?.status).toBe("stopped");

    await config.setWatchStatus({ matcher: "/blog", status: "active" });
    const afterResume = (await config.listWatch())[0];
    expect(afterResume?.status).toBe("active");
    expect(afterResume?.firstSeen).toBe(firstSeen);
  });

  it("guards on both composite-key attributes", async () => {
    const { dynamo, sends } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    await config.setWatchStatus({ matcher: "/blog", status: "stopped" });

    const update = sends.find((sent) => sent.name === "UpdateCommand");
    expect(update?.input.ConditionExpression).toBe("attribute_exists(pk) AND attribute_exists(sk)");
  });

  it("swallows a conditional miss on a non-existent watch row", async () => {
    const sends: Array<Sent> = [];
    const dynamo = {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sends.push({ name: command.constructor.name, input: command.input });
        const error = new Error("conditional failed");
        error.name = "ConditionalCheckFailedException";
        throw error;
      },
    };
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    const result = await config.setWatchStatus({ matcher: "/missing", status: "stopped" });
    expect(result).toBeUndefined();
  });
});

describe("Config.upsertWatch firstSeen", () => {
  it("preserves firstSeen across repeated upserts via if_not_exists", async () => {
    const { dynamo, sends } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    await config.upsertWatch({ matcher: "/blog", mode: "group", source: "sitemap" });
    const firstSeen = (await config.listWatch())[0]?.firstSeen;

    await config.upsertWatch({ matcher: "/blog", mode: "exact", source: "manual" });
    const afterSecond = (await config.listWatch())[0];

    expect(afterSecond?.firstSeen).toBe(firstSeen);
    expect(afterSecond?.mode).toBe("exact");
    expect(afterSecond?.source).toBe("manual");

    const update = sends.find((sent) => sent.name === "UpdateCommand");
    const expression = update?.input.UpdateExpression;
    if (typeof expression !== "string") throw new Error("expected string expression");
    expect(expression).toContain("#firstSeen = if_not_exists(#firstSeen, :now)");
  });
});

describe("Config.deleteWatch", () => {
  it("removes only the config row", async () => {
    const { dynamo, sends, store } = makeWatchDynamo();
    const config = new Config({ dynamo, tableName: "t", reverseIndexName: "reverse-index" });

    await config.upsertWatch({ matcher: "/blog", mode: "group", source: "manual" });
    store["watch#/blog|2026-05"] = {
      pk: "watch#/blog",
      sk: "2026-05",
      hits: 42,
    };

    await config.deleteWatch({ matcher: "/blog" });

    const del = sends.find((sent) => sent.name === "DeleteCommand");
    expect(del?.input.Key).toEqual({ pk: "watch#/blog", sk: "config" });
    expect(store["watch#/blog|config"]).toBeUndefined();
    expect(store["watch#/blog|2026-05"]).toBeDefined();
  });
});

describe("watchEntrySchema", () => {
  it("accepts a row carrying pk/sk and unknown future attrs via looseObject", () => {
    const stored = {
      pk: "watch#/blog",
      sk: "config",
      matcher: "/blog",
      mode: "group",
      source: "manual",
      status: "active",
      firstSeen: "2026-05-01",
      futureAttr: 123,
    };

    const result = v.safeParse(watchEntrySchema, stored);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected a successful parse");
    expect(result.output.matcher).toBe("/blog");
    expect(result.output.mode).toBe("group");
    expect((result.output as Record<string, unknown>).pk).toBe("watch#/blog");
    expect((result.output as Record<string, unknown>).futureAttr).toBe(123);
  });

  it("rejects an invalid mode", () => {
    const result = v.safeParse(watchEntrySchema, {
      matcher: "/blog",
      mode: "nope",
      source: "manual",
      status: "active",
      firstSeen: "2026-05-01",
    });
    expect(result.success).toBe(false);
  });
});
