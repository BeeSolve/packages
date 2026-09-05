import { describe, expect, it, mock } from "bun:test";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { SQSEvent, SQSRecord } from "aws-lambda";

// eventConsumer constructs a Dynamo client + Messages at module scope from these env vars.
// Set them before importing so the module-scope env parse succeeds.
process.env.DASHBOARD_TABLE_NAME ??= "test-table";
process.env.DASHBOARD_REVERSE_INDEX ??= "test-reverse-index";

const { createHandler } = await import("../src/eventConsumer.ts");
const { Messages } = await import("../src/lib/server/messages.ts");
const { GlobalStats } = await import("../src/lib/server/stats.ts");

function makeDynamo() {
  const send = mock(() => Promise.resolve<Record<string, unknown>>({}));
  const dynamo: Pick<DynamoDBDocumentClient, "send"> = { send };
  return { dynamo, send };
}

function makeHandler(dynamo: Pick<DynamoDBDocumentClient, "send">) {
  const messages = new Messages({ dynamo, tableName: "t", reverseIndexName: "reverse" });
  const stats = new GlobalStats({ dynamo, tableName: "t" });
  return createHandler({ messages, stats });
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict {
  if (value == null || typeof value !== "object") {
    throw new Error("Expected an object");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
  return value as Dict;
}

function transactRecordKeys(send: ReturnType<typeof mock>): Array<Dict> {
  return send.mock.calls
    .map((call) => call[0])
    .filter(
      (command): command is { input: Dict } =>
        command != null && typeof command === "object" && "input" in command,
    )
    .map((command) => asDict(command.input))
    .filter((input) => Array.isArray(input.TransactItems))
    .map((input) => {
      const items = asArray(input.TransactItems);
      return asDict(asDict(items[0]).Update).Key;
    })
    .map((key) => asDict(key));
}

function commandInputs(send: ReturnType<typeof mock>): Array<Dict> {
  return send.mock.calls
    .map((call) => call[0])
    .filter(
      (command): command is { input: Dict } =>
        command != null && typeof command === "object" && "input" in command,
    )
    .map((command) => asDict(command.input));
}

function asArray(value: unknown): Array<unknown> {
  if (!Array.isArray(value)) {
    throw new Error("Expected an array");
  }
  return value;
}

const messageId = "0100abc-messageid";
const eventTimestamp = "2024-06-01T12:00:00.000Z";
const recipient = "recipient@example.com";
const sender = "sender@example.com";

function sqsRecord({ messageId: id, body }: { messageId: string; body: string }): SQSRecord {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only fields the handler reads
  return {
    messageId: id,
    body,
    receiptHandle: "rh",
    attributes: {},
    messageAttributes: {},
    md5OfBody: "",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:eu-west-1:0:queue",
    awsRegion: "eu-west-1",
  } as SQSRecord;
}

function sqsEvent(records: Array<SQSRecord>): SQSEvent {
  return { Records: records };
}

function emailSentSuccessBody(): string {
  return JSON.stringify({
    id: "eb-requested",
    source: "beesolve.email.api",
    "detail-type": "EmailSentSuccess",
    detail: {
      requestId: "req-1",
      messageId,
      request: {
        id: "req-1",
        recipients: [recipient],
        subject: "Hello",
        sender: { name: "Sender", emailAddress: sender },
        html: "<p>hi</p>",
        text: "hi",
      },
    },
  });
}

function commonMail() {
  return {
    timestamp: eventTimestamp,
    messageId,
    source: sender,
    sendingAccountId: "000000000000",
    destination: [recipient],
    headersTruncated: false,
    headers: [{ name: "Subject", value: "Hello" }],
    commonHeaders: { subject: "Hello" },
  };
}

function sesSendBody(): string {
  return JSON.stringify({
    id: "eb-sent",
    source: "aws.ses",
    "detail-type": "Email Sent",
    detail: { mail: commonMail(), send: {} },
  });
}

function sesDeliveryBody(): string {
  return JSON.stringify({
    id: "eb-delivered",
    source: "aws.ses",
    "detail-type": "Email Delivered",
    detail: {
      mail: commonMail(),
      delivery: {
        timestamp: "2024-06-01T12:00:05.000Z",
        processingTimeMillis: 4200,
        recipients: [recipient],
        smtpResponse: "250 OK",
        reportingMTA: "a.example.com",
      },
    },
  });
}

function emailSentFailureBody(): string {
  return JSON.stringify({
    id: "eb-failed",
    source: "beesolve.email.api",
    "detail-type": "EmailSentFailure",
    detail: { requestId: "req-1" },
  });
}

describe("eventConsumer handler", () => {
  it("upserts a message for each parseable lifecycle event of one SES messageId", async () => {
    const { dynamo, send } = makeDynamo();
    const handler = makeHandler(dynamo);

    const response = await handler(
      sqsEvent([
        sqsRecord({ messageId: "sqs-1", body: emailSentSuccessBody() }),
        sqsRecord({ messageId: "sqs-2", body: sesSendBody() }),
        sqsRecord({ messageId: "sqs-3", body: sesDeliveryBody() }),
      ]),
    );

    expect(response.batchItemFailures).toEqual([]);

    const keys = transactRecordKeys(send);
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).toEqual({ pk: messageId, sk: "message" });
    }
  });

  it("swallows a duplicate event (ConditionalCheckFailed) without a batch failure", async () => {
    const { dynamo, send } = makeDynamo();
    // second upsert (the duplicate) is rejected as an idempotent cancellation
    send.mockImplementationOnce(() => Promise.resolve<Record<string, unknown>>({}));
    send.mockImplementationOnce(() =>
      Promise.reject(
        new TransactionCanceledException({
          $metadata: {},
          message: "",
          CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
        }),
      ),
    );
    const handler = makeHandler(dynamo);

    const response = await handler(
      sqsEvent([
        sqsRecord({ messageId: "sqs-1", body: sesSendBody() }),
        sqsRecord({ messageId: "sqs-2", body: sesSendBody() }),
      ]),
    );

    expect(response.batchItemFailures).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("skips an unparseable body without failing the whole batch", async () => {
    const { dynamo, send } = makeDynamo();
    const handler = makeHandler(dynamo);

    const response = await handler(
      sqsEvent([
        sqsRecord({ messageId: "sqs-1", body: "not-json-at-all" }),
        sqsRecord({ messageId: "sqs-2", body: sesSendBody() }),
      ]),
    );

    // garbage record is skipped (parseEmailEvent returns null) — not a batch failure
    expect(response.batchItemFailures).toEqual([]);
    // only the parseable record drove an upsert
    expect(transactRecordKeys(send)).toHaveLength(1);
  });

  it("reports a batch failure when an upsert throws a non-idempotent error", async () => {
    const { dynamo, send } = makeDynamo();
    send.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const handler = makeHandler(dynamo);

    const response = await handler(
      sqsEvent([sqsRecord({ messageId: "sqs-1", body: sesSendBody() })]),
    );

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "sqs-1" }]);
  });

  it("increments only the global failed counter for an EmailSentFailure (no message record)", async () => {
    const { dynamo, send } = makeDynamo();
    const handler = makeHandler(dynamo);

    const response = await handler(
      sqsEvent([sqsRecord({ messageId: "sqs-1", body: emailSentFailureBody() })]),
    );

    expect(response.batchItemFailures).toEqual([]);
    // no message record was written (no TransactWriteItems)
    expect(transactRecordKeys(send)).toHaveLength(0);
    // exactly one plain UpdateCommand: ADD failed :1 on the global stats record
    expect(send).toHaveBeenCalledTimes(1);
    const [input] = commandInputs(send);
    if (input == null) throw new Error("expected a send call");
    expect(input.Key).toEqual({ pk: "stats", sk: "global" });
    expect(input.UpdateExpression).toBe("ADD #counter :one");
    expect(input.ExpressionAttributeNames).toEqual({ "#counter": "failed" });
    expect(input.ExpressionAttributeValues).toEqual({ ":one": 1 });
  });
});
