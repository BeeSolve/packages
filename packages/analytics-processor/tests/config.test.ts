import { describe, expect, it } from "bun:test";

import { Config } from "../src/config.ts";

interface Sent {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function makeDynamo(options: { readonly throwConditional?: boolean } = {}) {
  const sends: Array<Sent> = [];
  const dynamo = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sends.push({ name: command.constructor.name, input: command.input });
      if (options.throwConditional === true) {
        const error = new Error("conditional failed");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }
      return {};
    },
  };
  return { dynamo, sends };
}

function makeStatefulDynamo(initial: Record<string, unknown> | null = null) {
  const sends: Array<Sent> = [];
  let item = initial;
  const dynamo = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sends.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetCommand") {
        return { Item: item == null ? undefined : item };
      }
      if (command.constructor.name === "UpdateCommand") {
        const values = command.input.ExpressionAttributeValues;
        const next: Record<string, unknown> = { ...item };
        if (isRecord(values)) {
          if (values[":url"] !== undefined) next.sitemapUrl = values[":url"];
        }
        item = next;
      }
      return {};
    },
  };
  return { dynamo, sends };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

describe("Config.ensureStart", () => {
  it("writes the start boundary with an earlier-or-absent condition", async () => {
    const { dynamo, sends } = makeDynamo();
    const config = new Config({ dynamo, tableName: "t" });

    await config.ensureStart({ hourKey: "2026-10-13-11" });

    expect(sends).toHaveLength(1);
    expect(sends[0]?.name).toBe("UpdateCommand");
    expect(sends[0]?.input.ConditionExpression).toBe(
      "attribute_not_exists(#startKey) OR :hourKey < #startKey",
    );
  });

  it("swallows a ConditionalCheckFailedException (start already earlier)", async () => {
    const { dynamo } = makeDynamo({ throwConditional: true });
    const config = new Config({ dynamo, tableName: "t" });

    const result = await config.ensureStart({ hourKey: "2026-10-13-11" });
    expect(result).toBeUndefined();
  });
});

describe("Config.getSitemapConfig", () => {
  it("returns an empty object when the config item is missing", async () => {
    const { dynamo } = makeStatefulDynamo(null);
    const config = new Config({ dynamo, tableName: "t" });

    const result = await config.getSitemapConfig();
    expect(result).toEqual({});
  });

  it("sets the sitemap url and reads it back", async () => {
    const { dynamo, sends } = makeStatefulDynamo({});
    const config = new Config({ dynamo, tableName: "t" });

    await config.setSitemapUrl({ sitemapUrl: "https://example.com/sitemap.xml" });

    const update = sends.find((sent) => sent.name === "UpdateCommand");
    expect(update?.input.UpdateExpression).toBe("SET #sitemapUrl = :url");

    const result = await config.getSitemapConfig();
    expect(result.sitemapUrl).toBe("https://example.com/sitemap.xml");
  });

  it("tolerates a legacy config item carrying removed sitemap fields", async () => {
    const { dynamo } = makeStatefulDynamo({
      pk: "system#config",
      sk: "analytics",
      startKey: "2026-10-13-11",
      startedAt: "2026-10-13T11:00:00.000Z",
      sitemapPaths: ["/", "/blog"],
      sitemapFetchedAt: "2026-10-13T11:00:00.000Z",
    });
    const config = new Config({ dynamo, tableName: "t" });

    const result = await config.getSitemapConfig();
    expect(result.sitemapUrl).toBeUndefined();
  });

  it("tolerates a legacy config item lacking the sitemap url", async () => {
    const { dynamo } = makeStatefulDynamo({
      pk: "system#config",
      sk: "analytics",
      startKey: "2026-10-13-11",
      startedAt: "2026-10-13T11:00:00.000Z",
    });
    const config = new Config({ dynamo, tableName: "t" });

    const result = await config.getSitemapConfig();
    expect(result.sitemapUrl).toBeUndefined();
  });

  it("parses a legacy full config item via configSchema", async () => {
    const { dynamo } = makeStatefulDynamo({
      pk: "system#config",
      sk: "analytics",
      startKey: "2026-10-13-11",
      startedAt: "2026-10-13T11:00:00.000Z",
    });
    const config = new Config({ dynamo, tableName: "t" });

    const result = await config.get();
    expect(result?.startKey).toBe("2026-10-13-11");
    expect(result?.sitemapUrl).toBeUndefined();
  });
});
