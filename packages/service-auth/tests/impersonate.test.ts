import { describe, expect, it, mock } from "bun:test";

import { encodeToStringifiable } from "@beesolve/helpers";

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

function commandInput(name: string): Record<string, unknown> {
  const call = dynamoSend.mock.calls.find((call) => commandName(call[0]) === name)?.[0];
  if (call == null) throw new Error(`expected a ${name}`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (call as { input: Record<string, unknown> }).input;
}

function sessionItem(
  overrides: { userId?: string; impersonatedId?: string; expiresAtSeconds?: number } = {},
) {
  const now = new Date();
  return {
    id: "impersonator-sid",
    sessionId: "logical-session-id",
    userId: overrides.userId ?? "the-impersonator",
    impersonatedId: overrides.impersonatedId,
    startedAt: new Date(now.getTime() - 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    expiresAt: overrides.expiresAtSeconds ?? Math.round((now.getTime() + 3_600_000) / 1000),
  };
}

function mockDynamo(item: ReturnType<typeof sessionItem> | undefined) {
  dynamoSend.mockReset();
  putEventsCalls.length = 0;
  dynamoSend.mockImplementation((command: unknown) => {
    if (commandName(command) === "GetCommand") return Promise.resolve({ Item: item });
    return Promise.resolve({});
  });
}

async function invokeImpersonate(request: {
  targetUserId: string;
  cookieHeader: string;
}): Promise<undefined> {
  // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion
  const event = encodeToStringifiable({ type: "impersonate", request }) as any;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await handler(event, undefined)) as undefined;
}

const cookieHeader = "__Host-SID=impersonator-sid";

describe("impersonate SDK command", () => {
  it("mutates the impersonator's session with impersonatedId and emits ImpersonationStarted", async () => {
    mockDynamo(sessionItem());

    const result = await invokeImpersonate({ targetUserId: "target-user", cookieHeader });

    expect(result).toBeUndefined();

    const input = commandInput("UpdateCommand");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect((input.Key as { id: string }).id).toBe("impersonator-sid");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect((input.ExpressionAttributeValues as Record<string, unknown>)[":impersonatedId"]).toBe(
      "target-user",
    );

    expect(putEventsCalls).toHaveLength(1);
    const entry = putEventsCalls[0]?.Entries[0];
    expect(entry?.DetailType).toBe("ImpersonationStarted");
    const detail = JSON.parse(entry?.Detail ?? "{}");
    expect(detail.currentUserId).toBe("the-impersonator");
    expect(detail.targetUserId).toBe("target-user");
    expect(typeof detail.startedAt).toBe("string");
  });

  it("throws when the cookie has no __Host-SID entry", async () => {
    mockDynamo(sessionItem());

    expect(
      invokeImpersonate({ targetUserId: "target-user", cookieHeader: "other=value" }),
    ).rejects.toThrow();
  });

  it("throws when the session has expired", async () => {
    mockDynamo(sessionItem({ expiresAtSeconds: Math.round((Date.now() - 60_000) / 1000) }));

    expect(invokeImpersonate({ targetUserId: "target-user", cookieHeader })).rejects.toThrow();
  });

  it("throws when the session is already impersonating", async () => {
    mockDynamo(sessionItem({ impersonatedId: "someone-else" }));

    expect(invokeImpersonate({ targetUserId: "target-user", cookieHeader })).rejects.toThrow();
  });
});
