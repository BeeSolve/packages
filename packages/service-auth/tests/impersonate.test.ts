import { describe, expect, it, mock } from "bun:test";

import { encodeToStringifiable } from "@beesolve/helpers";

import { Sessions } from "../src/session.ts";

process.env.SESSIONS_TABLE_NAME = "sessions";
process.env.SESSIONS_USER_ID_INDEX_NAME = "userIdGsi";
process.env.ACCOUNTS_TABLE_NAME = "accounts";
process.env.ACCOUNTS_REVERSE_INDEX_NAME = "accountsReverse";
process.env.EVENT_BUS_ARN = "arn:aws:events:us-east-1:123456789012:event-bus/auth";
process.env.EVENT_SOURCE = "auth-service";

interface PutEventsEntry {
  readonly DetailType: string;
  readonly Detail: string;
}

const dynamoSend = mock((_command: unknown): Promise<unknown> => Promise.resolve({}));
const putEventsCalls: Array<{ Entries: Array<PutEventsEntry> }> = [];

void mock.module("../src/dynamo.ts", () => ({
  toDynamoClient: () => ({ send: dynamoSend }),
}));

void mock.module("@aws-sdk/client-eventbridge", () => ({
  EventBridge: class {
    putEvents(input: { Entries: Array<PutEventsEntry> }) {
      putEventsCalls.push(input);
      return Promise.resolve({ FailedEntryCount: 0 });
    }
  },
}));

void mock.module("@beesolve/lambda-keep-active/runtime", () => ({
  // oxlint-disable-next-line typescript/no-explicit-any
  keptActive: (handler: any) => handler,
}));

const { handler } = await import("../sdkHandler.ts");

function commandName(command: unknown): string {
  return command != null && typeof command === "object" ? command.constructor.name : "";
}

function putItem(send: { mock: { calls: Array<Array<unknown>> } }): Record<string, unknown> {
  const call = send.mock.calls.find((call) => commandName(call[0]) === "PutCommand")?.[0];
  if (call == null) throw new Error("expected a PutCommand");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (call as { input: { Item: Record<string, unknown> } }).input.Item;
}

async function invokeImpersonate(request: {
  targetUserId: string;
  currentUserId: string;
  maxAge?: number;
}): Promise<{ sid: string; maxAge: number }> {
  // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion
  const event = encodeToStringifiable({ type: "impersonate", request }) as any;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await handler(event, undefined)) as { sid: string; maxAge: number };
}

describe("impersonate SDK command", () => {
  it("creates a session with impersonatedBy and emits ImpersonationStarted", async () => {
    dynamoSend.mockReset();
    putEventsCalls.length = 0;
    dynamoSend.mockImplementation(() => Promise.resolve({}));

    const result = await invokeImpersonate({
      targetUserId: "target-user",
      currentUserId: "operator-1",
    });

    expect(typeof result.sid).toBe("string");

    const item = putItem(dynamoSend);
    expect(item.userId).toBe("target-user");
    expect(item.impersonatedBy).toBe("operator-1");

    expect(putEventsCalls).toHaveLength(1);
    const entry = putEventsCalls[0]?.Entries[0];
    expect(entry?.DetailType).toBe("ImpersonationStarted");
    const detail = JSON.parse(entry?.Detail ?? "{}");
    expect(detail.currentUserId).toBe("operator-1");
    expect(detail.targetUserId).toBe("target-user");
  });

  it("defaults maxAge to 3600 when not provided", async () => {
    dynamoSend.mockReset();
    putEventsCalls.length = 0;
    dynamoSend.mockImplementation(() => Promise.resolve({}));

    const result = await invokeImpersonate({
      targetUserId: "target-user",
      currentUserId: "operator-1",
    });

    expect(result.maxAge).toBe(3600);
  });

  it("passes maxAge through when within the cap", async () => {
    dynamoSend.mockReset();
    putEventsCalls.length = 0;
    dynamoSend.mockImplementation(() => Promise.resolve({}));

    const result = await invokeImpersonate({
      targetUserId: "target-user",
      currentUserId: "operator-1",
      maxAge: 7200,
    });

    expect(result.maxAge).toBe(7200);
  });

  it("caps maxAge at 14400 (4 hours)", async () => {
    dynamoSend.mockReset();
    putEventsCalls.length = 0;
    dynamoSend.mockImplementation(() => Promise.resolve({}));

    const result = await invokeImpersonate({
      targetUserId: "target-user",
      currentUserId: "operator-1",
      maxAge: 999_999,
    });

    expect(result.maxAge).toBe(14400);
  });
});

describe("Sessions.createOne impersonatedBy", () => {
  it("writes impersonatedBy into the DynamoDB item when provided", async () => {
    const send = mock((_command: unknown) => Promise.resolve({}));
    const sessions = new Sessions({
      dynamo: { send },
      tableName: "sessions",
      userIdIndexName: "userIdGsi",
    });

    await sessions.createOne({
      userId: "target-user",
      data: {},
      impersonatedBy: "operator-1",
    });

    const item = putItem(send);
    expect(item.userId).toBe("target-user");
    expect(item.impersonatedBy).toBe("operator-1");
  });

  it("omits impersonatedBy (undefined) when not provided", async () => {
    const send = mock((_command: unknown) => Promise.resolve({}));
    const sessions = new Sessions({
      dynamo: { send },
      tableName: "sessions",
      userIdIndexName: "userIdGsi",
    });

    await sessions.createOne({
      userId: "normal-user",
      data: {},
    });

    const item = putItem(send);
    expect(item.userId).toBe("normal-user");
    expect(item.impersonatedBy).toBeUndefined();
  });
});
