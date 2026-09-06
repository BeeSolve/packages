import { describe, expect, it, mock } from "bun:test";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { Messages } from "../src/lib/server/messages.ts";

function makeDynamo() {
  const send = mock(() => Promise.resolve<Record<string, unknown>>({}));
  const dynamo: Pick<DynamoDBDocumentClient, "send"> = { send };
  return { dynamo, send };
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict {
  if (value == null || typeof value !== "object") {
    throw new Error("Expected an object");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
  return value as Dict;
}

function getCommandInput(send: ReturnType<typeof mock>, index = 0): Dict {
  const command = send.mock.calls[index]?.[0];
  if (command == null || typeof command !== "object" || !("input" in command)) {
    throw new Error(`No command input at call index ${String(index)}`);
  }
  return asDict(command.input);
}

function transactItems(input: Dict): Array<Dict> {
  if (!Array.isArray(input.TransactItems)) {
    throw new Error("Expected TransactItems array");
  }
  return input.TransactItems.map((item) => asDict(item));
}

function update(items: Array<Dict>, index: number): Dict {
  return asDict(items[index]?.Update);
}

function put(items: Array<Dict>, index: number): Dict {
  return asDict(items[index]?.Put);
}

function names(command: Dict): Dict {
  return asDict(command.ExpressionAttributeNames);
}

function values(command: Dict): Dict {
  return asDict(command.ExpressionAttributeValues);
}

const messageId = "0100abc-messageid";
const createdAt = "2024-06-01T12:00:00.000Z";

type UpsertProps = Parameters<Messages["upsert"]>[0];

function sentProps(): UpsertProps {
  return {
    eventId: "event-sent",
    messageId,
    recipients: ["recipient@example.com"],
    subject: "Hello",
    sender: "sender@example.com",
    createdAt,
    data: { status: "sent", timestamp: createdAt },
  };
}

function requestedProps(): UpsertProps {
  return {
    eventId: "event-requested",
    messageId,
    recipients: ["recipient@example.com", "second@example.com"],
    subject: "Hello",
    sender: "sender@example.com",
    createdAt,
    data: { status: "requested", requestId: "req-1", timestamp: createdAt },
  };
}

function deliveredProps(): UpsertProps {
  return {
    eventId: "event-delivered",
    messageId,
    recipients: ["recipient@example.com", "second@example.com"],
    subject: "Hello",
    sender: "sender@example.com",
    createdAt,
    data: {
      status: "delivered",
      deliveredAt: "2024-06-01T12:00:05.000Z",
      deliveryMs: 4200,
      timestamp: "2024-06-01T12:00:05.000Z",
      recipients: ["recipient@example.com"],
    },
  };
}

describe("Messages.upsert", () => {
  it("throws when recipients exceed 48", async () => {
    const { dynamo, send } = makeDynamo();
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const recipients = Array.from({ length: 49 }, (_unused, index) => `r${String(index)}@x.com`);

    expect(messages.upsert({ ...sentProps(), recipients })).rejects.toThrow(/up to 48 recipients/);
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("throws when there are zero recipients", async () => {
    const { dynamo, send } = makeDynamo();
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    expect(messages.upsert({ ...sentProps(), recipients: [] })).rejects.toThrow(
      /At least one recipient/,
    );
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("issues one TransactWrite with record update, global stats, recipient stats, relations and month record for a sent event", async () => {
    const { dynamo, send } = makeDynamo();
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    await messages.upsert(sentProps());

    expect(send).toHaveBeenCalledTimes(1);
    const items = transactItems(getCommandInput(send));

    // record update + global stats + 1 recipient stats + 1 relation + month record
    expect(items).toHaveLength(5);

    const recordUpdate = update(items, 0);
    expect(recordUpdate.Key).toEqual({ pk: messageId, sk: "message" });
    expect(recordUpdate.ConditionExpression).toBe("not contains(#idempotencyKeys, :eventId)");
    expect(String(recordUpdate.UpdateExpression)).toContain(
      "ADD #messageLog :messageLog, #idempotencyKeys :eventIdSet",
    );
    const recordValues = values(recordUpdate);
    expect(recordValues[":requestId"]).toBeUndefined();
    expect(recordValues[":messageLog"]).toBeInstanceOf(Set);
    expect(recordValues[":eventIdSet"]).toBeInstanceOf(Set);
    const eventIdSet = recordValues[":eventIdSet"];
    if (!(eventIdSet instanceof Set)) throw new Error("expected a Set");
    expect([...eventIdSet]).toEqual(["event-sent"]);
    expect(recordValues[":eventId"]).toBe("event-sent");

    const globalStats = update(items, 1);
    expect(globalStats.Key).toEqual({ pk: "stats", sk: "global" });
    expect(globalStats.UpdateExpression).toBe("ADD #counter :one");
    expect(names(globalStats)["#counter"]).toBe("sent");
    expect(values(globalStats)[":one"]).toBe(1);

    const recipientStats = update(items, 2);
    expect(recipientStats.Key).toEqual({ pk: "recipient@example.com", sk: "recipient" });
    expect(names(recipientStats)["#counter"]).toBe("sent");

    const relation = put(items, 3);
    expect(relation.Item).toEqual({
      pk: "recipient@example.com",
      sk: `message#${createdAt}#${messageId}`,
    });

    const monthRecord = put(items, 4);
    expect(monthRecord.Item).toEqual({
      pk: "2024-06",
      sk: `${createdAt}#${messageId}`,
    });
  });

  it("carries the requestId for a requested event and writes stats per recipient", async () => {
    const { dynamo, send } = makeDynamo();
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    await messages.upsert(requestedProps());

    const items = transactItems(getCommandInput(send));
    // record + global + 2 recipient stats (no relations or month record for requested events)
    expect(items).toHaveLength(4);
    expect(values(update(items, 0))[":requestId"]).toBe("req-1");
    expect(names(update(items, 1))["#counter"]).toBe("requested");
    expect(update(items, 2).Key).toEqual({ pk: "recipient@example.com", sk: "recipient" });
    expect(update(items, 3).Key).toEqual({ pk: "second@example.com", sk: "recipient" });
  });

  it("uses data.recipients for terminal stats but props.recipients for relations", async () => {
    const { dynamo, send } = makeDynamo();
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    await messages.upsert(deliveredProps());

    const items = transactItems(getCommandInput(send));
    // record + global + 1 recipient stat (data.recipients) + 2 relations (props.recipients) + month
    expect(items).toHaveLength(6);

    expect(names(update(items, 1))["#counter"]).toBe("delivered");

    const recipientStats = update(items, 2);
    expect(recipientStats.Key).toEqual({ pk: "recipient@example.com", sk: "recipient" });

    const firstRelation = put(items, 3);
    expect(firstRelation.Item).toEqual({
      pk: "recipient@example.com",
      sk: `message#${createdAt}#${messageId}`,
    });
    const secondRelation = put(items, 4);
    expect(secondRelation.Item).toEqual({
      pk: "second@example.com",
      sk: `message#${createdAt}#${messageId}`,
    });

    const monthRecord = put(items, 5);
    expect(monthRecord.Item).toEqual({ pk: "2024-06", sk: `${createdAt}#${messageId}` });
  });

  it("treats a ConditionalCheckFailed cancellation as already-applied and does not throw", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockRejectedValueOnce(
      new TransactionCanceledException({
        $metadata: {},
        message: "",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      }),
    );
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    await messages.upsert(sentProps());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors that are not an idempotent cancellation", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockRejectedValueOnce(new Error("boom"));
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    expect(messages.upsert(sentProps())).rejects.toThrow(/boom/);
  });
});

const mailTimestamp = "2024-06-01T12:00:00.000Z";

function storedMessageItem() {
  return {
    pk: messageId,
    sk: "message",
    requestId: "req-1",
    recipients: ["recipient@example.com"],
    sender: "sender@example.com",
    subject: "Hello",
    createdAt: mailTimestamp,
    updatedAt: "2024-06-01T12:00:20.000Z",
    messageLog: new Set([
      JSON.stringify({
        recipient: "recipient@example.com",
        status: "complained",
        at: "2024-06-01T12:00:20.000Z",
        timestamp: "2024-06-01T12:00:20.000Z",
      }),
      JSON.stringify({
        recipient: "recipient@example.com",
        status: "sent",
        timestamp: mailTimestamp,
      }),
      JSON.stringify({
        recipient: "recipient@example.com",
        status: "delivered",
        deliveredAt: "2024-06-01T12:00:05.000Z",
        deliveryMs: 4200,
        timestamp: "2024-06-01T12:00:05.000Z",
      }),
    ]),
    idempotencyKeys: new Set(["event-sent", "event-delivered", "event-complained"]),
  };
}

describe("Messages.messageManyByRecipient", () => {
  it("queries begins_with(message#) on the lowercased email then BatchGets and folds status", async () => {
    const { dynamo, send } = makeDynamo();
    send
      .mockResolvedValueOnce({
        Items: [{ pk: "recipient@example.com", sk: `message#${createdAt}#${messageId}` }],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({ Responses: { t: [storedMessageItem()] } });
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const result = await messages.messageManyByRecipient({ email: "Recipient@Example.com" });

    const queryInput = getCommandInput(send, 0);
    expect(queryInput.KeyConditionExpression).toBe("#pk = :pk and begins_with(#sk, :sk)");
    expect(values(queryInput)[":pk"]).toBe("recipient@example.com");
    expect(values(queryInput)[":sk"]).toBe("message#");

    expect(result.items).toHaveLength(1);
    const model = result.items[0];
    expect(model?.id).toBe(messageId);
    // latest by timestamp is the complaint at 12:00:20
    expect(model?.status).toBe("complained");
    const grouped = model?.logByRecipient["recipient@example.com"];
    expect(grouped).toHaveLength(3);
    expect(grouped?.map((entry) => entry.status)).toEqual(["sent", "delivered", "complained"]);
  });
});

describe("Messages.messagesManyForMonth", () => {
  it("queries pk = YYYY-MM then BatchGets", async () => {
    const { dynamo, send } = makeDynamo();
    send
      .mockResolvedValueOnce({
        Items: [{ pk: "2024-06", sk: `${createdAt}#${messageId}` }],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({ Responses: { t: [storedMessageItem()] } });
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const result = await messages.messagesManyForMonth({ month: { year: 2024, month: 6 } });

    const queryInput = getCommandInput(send, 0);
    expect(queryInput.KeyConditionExpression).toBe("#pk = :pk");
    expect(values(queryInput)[":pk"]).toBe("2024-06");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(messageId);
  });
});

describe("Messages.getById", () => {
  it("GetCommands pk/sk and returns a parsed MessageModel", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Item: storedMessageItem() });
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const model = await messages.getById({ messageId });

    const getInput = getCommandInput(send, 0);
    expect(getInput.Key).toEqual({ pk: messageId, sk: "message" });
    expect(model?.id).toBe(messageId);
    // latest by timestamp is the complaint at 12:00:20
    expect(model?.status).toBe("complained");
    expect(model?.logByRecipient["recipient@example.com"]).toHaveLength(3);
  });

  it("returns null when the item is not found", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockResolvedValueOnce({ Item: undefined });
    const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });

    const model = await messages.getById({ messageId });

    expect(model).toBeNull();
  });
});
