import { describe, expect, mock, test } from "bun:test";

import { encodeToStringifiable } from "@beesolve/helpers";
import type { SQSEvent } from "aws-lambda";

import { createSqsHandlers } from "../index";

function makeSqsRecord(messageId: string, body: object): SQSEvent["Records"][number] {
  return {
    messageId,
    receiptHandle: "receipt",
    body: JSON.stringify(body),
    attributes: {
      ApproximateFirstReceiveTimestamp: "0",
      ApproximateReceiveCount: "1",
      SenderId: "sender",
      SentTimestamp: "0",
    },
    messageAttributes: {},
    md5OfBody: "md5",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123:test-queue",
    awsRegion: "us-east-1",
  };
}

describe("createSqsHandlers — handler", () => {
  test("processes a valid record and calls the function with decoded args", async () => {
    const greet = mock(async (_name: string) => {});
    const [handler] = createSqsHandlers({
      functions: { greet },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: mock(async () => {}) },
      fifo: false,
    });

    const event: SQSEvent = {
      Records: [
        makeSqsRecord("msg-1", {
          fn: "greet",
          args: [encodeToStringifiable("Alice")],
        }),
      ],
    };

    const result = await handler(event);

    expect(greet).toHaveBeenCalledTimes(1);
    expect(greet).toHaveBeenCalledWith("Alice");
    expect(result.batchItemFailures).toEqual([]);
  });

  test("adds record to batchItemFailures when message format is invalid", async () => {
    const [handler] = createSqsHandlers({
      functions: { noop: async () => {} },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: mock(async () => {}) },
      fifo: false,
    });

    const event: SQSEvent = {
      Records: [
        {
          ...makeSqsRecord("msg-bad", {}),
          body: "not-valid-json{{{",
        },
      ],
    };

    const result = await handler(event);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-bad" }]);
  });

  test("adds record to batchItemFailures for unknown function name", async () => {
    const [handler] = createSqsHandlers({
      functions: { noop: async () => {} },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: mock(async () => {}) },
      fifo: false,
    });

    const event: SQSEvent = {
      Records: [
        makeSqsRecord("msg-unknown", {
          fn: "unknownFunction",
          args: [],
        }),
      ],
    };

    const result = await handler(event);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-unknown" }]);
  });

  test("adds record to batchItemFailures when function throws", async () => {
    const fail = async () => {
      throw new Error("boom");
    };
    const [handler] = createSqsHandlers({
      functions: { fail },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: mock(async () => {}) },
      fifo: false,
    });

    const event: SQSEvent = {
      Records: [makeSqsRecord("msg-throw", { fn: "fail", args: [] })],
    };

    const result = await handler(event);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-throw" }]);
  });

  test("processes multiple records and tracks failures independently", async () => {
    const good = mock(async () => {});
    const bad = async () => {
      throw new Error("fail");
    };
    const [handler] = createSqsHandlers({
      functions: { good, bad },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: mock(async () => {}) },
      fifo: false,
    });

    const event: SQSEvent = {
      Records: [
        makeSqsRecord("msg-1", { fn: "good", args: [] }),
        makeSqsRecord("msg-2", { fn: "bad", args: [] }),
        makeSqsRecord("msg-3", { fn: "good", args: [] }),
      ],
    };

    const result = await handler(event);
    expect(good).toHaveBeenCalledTimes(2);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-2" }]);
  });
});

describe("createSqsHandlers — queued functions", () => {
  test("sends a SendMessageCommand to the SQS client", async () => {
    const sendMock = mock(async (_command: unknown) => {});
    const process = async (_data: string) => {};
    const [, functions] = createSqsHandlers({
      functions: { process },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: sendMock },
      fifo: false,
    });

    functions.process("payload");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]![0] as any;
    expect(command.input.QueueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123/queue");
    const body = JSON.parse(command.input.MessageBody);
    expect(body.fn).toBe("process");
  });

  test("invokes function directly when localInvocation is true", () => {
    const process = mock(async (_data: string) => {});
    const [, functions] = createSqsHandlers({
      functions: { process },
      queueUrls: { main: "https://sqs.us-east-1.amazonaws.com/123/queue" },
      sqsClient: { send: mock(async () => {}) },
      localInvocation: true,
      fifo: false,
    });

    functions.process("local-data");

    expect(process).toHaveBeenCalledWith("local-data");
  });
});
