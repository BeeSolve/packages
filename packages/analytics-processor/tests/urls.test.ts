import { describe, expect, it } from "bun:test";

import { UrlDirectory } from "../src/urls.ts";

interface RecordedCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") throw new Error("expected object");
  return Object.fromEntries(Object.entries(value));
}

function makeDynamo(items: Array<Record<string, unknown>> = []) {
  const sends: Array<RecordedCommand> = [];
  const dynamo = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sends.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "QueryCommand") {
        return { Items: items };
      }
      return {};
    },
  };
  return { dynamo, sends };
}

describe("UrlDirectory", () => {
  it("upserts each url with an idempotent if_not_exists firstSeen SET", async () => {
    const { dynamo, sends } = makeDynamo();
    const directory = new UrlDirectory({ dynamo, tableName: "t" });

    await directory.upsertManyFirstSeen({ urls: ["/a", "/b"], day: "2026-02-14" });

    expect(sends.length).toBe(2);
    for (const send of sends) {
      expect(send.name).toBe("UpdateCommand");
      expect(String(send.input.UpdateExpression)).toBe(
        "SET #firstSeen = if_not_exists(#firstSeen, :day)",
      );
      const values = asRecord(send.input.ExpressionAttributeValues);
      expect(values[":day"]).toBe("2026-02-14");
    }

    const first = sends[0];
    if (first == null) throw new Error("expected a command");
    const key = asRecord(first.input.Key);
    expect(key.pk).toBe("/a");
    expect(key.sk).toBe("url");
  });

  it("does not move firstSeen forward on repeat writes (if_not_exists)", async () => {
    const { dynamo, sends } = makeDynamo();
    const directory = new UrlDirectory({ dynamo, tableName: "t" });

    await directory.upsertManyFirstSeen({ urls: ["/a"], day: "2026-01-01" });
    await directory.upsertManyFirstSeen({ urls: ["/a"], day: "2026-03-01" });

    expect(sends.length).toBe(2);
    for (const send of sends) {
      expect(String(send.input.UpdateExpression)).toContain("if_not_exists(#firstSeen, :day)");
    }
  });

  it("lists urls from the reverse index mapping pk to url", async () => {
    const { dynamo, sends } = makeDynamo([
      { pk: "/a", sk: "url", firstSeen: "2026-01-01" },
      { pk: "/b", sk: "url", firstSeen: "2026-02-02" },
    ]);
    const directory = new UrlDirectory({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const urls = await directory.listUrls();

    expect(urls).toEqual([
      { url: "/a", firstSeen: "2026-01-01" },
      { url: "/b", firstSeen: "2026-02-02" },
    ]);

    const query = sends.find((send) => send.name === "QueryCommand");
    if (query == null) throw new Error("expected a query");
    expect(query.input.IndexName).toBe("reverse");
    const values = asRecord(query.input.ExpressionAttributeValues);
    expect(values[":sk"]).toBe("url");
  });

  it("throws when listUrls is called without a reverse index", async () => {
    const { dynamo } = makeDynamo();
    const directory = new UrlDirectory({ dynamo, tableName: "t" });
    let message = "";
    try {
      await directory.listUrls();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("reverseIndexName");
  });
});
