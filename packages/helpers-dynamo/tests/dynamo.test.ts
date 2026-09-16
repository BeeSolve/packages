import { describe, expect, test } from "bun:test";

import * as v from "valibot";

import { batchGet, queryAll } from "../index";

interface SendCall {
  input: Record<string, unknown>;
}

function mockDynamo(handler: (call: SendCall, index: number) => unknown) {
  const calls: Array<SendCall> = [];
  return {
    calls,
    send: (command: { input: Record<string, unknown> }) => {
      const call = { input: command.input };
      const index = calls.length;
      calls.push(call);
      return Promise.resolve(handler(call, index));
    },
  };
}

describe("queryAll", () => {
  test("returns a single page unchanged", async () => {
    const dynamo = mockDynamo(() => ({ Items: [{ id: "a" }, { id: "b" }] }));

    const result = await queryAll({ dynamo, input: { TableName: "t" } });

    expect(result).toEqual([{ id: "a" }, { id: "b" }]);
    expect(dynamo.calls.length).toBe(1);
  });

  test("follows LastEvaluatedKey across pages and concatenates", async () => {
    const pages = [
      { Items: [{ id: "1" }], LastEvaluatedKey: { id: "1" } },
      { Items: [{ id: "2" }], LastEvaluatedKey: { id: "2" } },
      { Items: [{ id: "3" }] },
    ];
    const dynamo = mockDynamo((_call, index) => pages[index]);

    const result = await queryAll({ dynamo, input: { TableName: "t" } });

    expect(result).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(dynamo.calls.length).toBe(3);
    expect(dynamo.calls[0]?.input.ExclusiveStartKey).toBeUndefined();
    expect(dynamo.calls[1]?.input.ExclusiveStartKey).toEqual({ id: "1" });
    expect(dynamo.calls[2]?.input.ExclusiveStartKey).toEqual({ id: "2" });
  });

  test("returns an empty array when there are no items", async () => {
    const dynamo = mockDynamo(() => ({}));

    const result = await queryAll({ dynamo, input: { TableName: "t" } });

    expect(result).toEqual([]);
  });
});

describe("batchGet", () => {
  test("returns an empty array without calling dynamo when keys are empty", async () => {
    const dynamo = mockDynamo(() => ({}));

    const result = await batchGet({
      dynamo,
      keys: [],
      tableName: "t",
      toInput: (batch) => ({ Keys: batch.map((id) => ({ id })) }),
      transform: (raw) => raw,
    });

    expect(result).toEqual([]);
    expect(dynamo.calls.length).toBe(0);
  });

  test("deduplicates keys and maps results back in key order", async () => {
    const dynamo = mockDynamo(() => ({
      Responses: {
        t: [
          { id: "a", value: 1 },
          { id: "b", value: 2 },
        ],
      },
    }));

    const result = await batchGet<string, { id: string; value: number }>({
      dynamo,
      keys: ["a", "b", "a"],
      tableName: "t",
      toInput: (batch) => ({ Keys: batch.map((id) => ({ id })) }),
      transform: (raw) => ({ id: String(raw.id), value: Number(raw.value) }),
    });

    expect(result).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "a", value: 1 },
    ]);
    expect(dynamo.calls.length).toBe(1);
    expect(dynamo.calls[0]?.input.RequestItems).toEqual({
      t: { Keys: [{ id: "a" }, { id: "b" }] },
    });
  });

  test("splits more than 100 unique keys into separate batches", async () => {
    const keys = Array.from({ length: 150 }, (_unused, index) => `k${index}`);
    const requestSchema = v.object({
      RequestItems: v.object({ t: v.object({ Keys: v.array(v.object({ id: v.string() })) }) }),
    });
    const dynamo = mockDynamo((call) => {
      const { RequestItems } = v.parse(requestSchema, call.input);
      return { Responses: { t: RequestItems.t.Keys.map(({ id }) => ({ id })) } };
    });

    const result = await batchGet<string, { id: string }>({
      dynamo,
      keys,
      tableName: "t",
      toInput: (batch) => ({ Keys: batch.map((id) => ({ id })) }),
      transform: (raw) => ({ id: String(raw.id) }),
    });

    expect(result.length).toBe(150);
    expect(dynamo.calls.length).toBe(2);
  });

  test("throws when a requested key has no data", async () => {
    const dynamo = mockDynamo(() => ({ Responses: { t: [{ id: "a" }] } }));

    const promise = batchGet<string, { id: string }>({
      dynamo,
      keys: ["a", "missing"],
      tableName: "t",
      toInput: (batch) => ({ Keys: batch.map((id) => ({ id })) }),
      transform: (raw) => ({ id: String(raw.id) }),
    });

    expect(promise).rejects.toThrow("missing data");
  });
});
