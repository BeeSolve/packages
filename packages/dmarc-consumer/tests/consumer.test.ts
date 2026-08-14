import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { SQSEvent } from "aws-lambda";

process.env.TABLE_NAME = "test-table";
process.env.REVERSE_INDEX_NAME = "reverse";

const sendMock = mock(() => Promise.resolve({}));

void mock.module("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {
    send = sendMock;
  },
}));

void mock.module("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: sendMock }),
  },
  BatchWriteCommand: class {
    constructor(public readonly input: unknown) {}
  },
  QueryCommand: class {
    constructor(public readonly input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

function makeSqsEvent(bodies: Array<unknown>): SQSEvent {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `handle-${i}`,
      body: JSON.stringify(body),
      attributes: {
        ApproximateReceiveCount: "1",
        SentTimestamp: "1704067200000",
        SenderId: "123456789012",
        ApproximateFirstReceiveTimestamp: "1704067200000",
      },
      messageAttributes: {},
      md5OfBody: "abc",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:queue",
      awsRegion: "us-east-1",
    })),
  };
}

function makeValidEventBody(domain = "example.org") {
  return {
    source: "dmarc-reports",
    "detail-type": "DmarcReportParsed",
    detail: {
      reportMetadata: {
        orgName: "Google Inc.",
        email: "noreply@google.com",
        reportId: "rpt-001",
        dateRange: { begin: 1704067200, end: 1704153600 },
      },
      policyPublished: {
        domain,
        adkim: "r",
        aspf: "r",
        p: "none",
        pct: 100,
      },
      records: [
        {
          sourceIp: "192.0.2.1",
          count: 5,
          policyEvaluated: { disposition: "none", dkim: "pass", spf: "pass" },
          identifiers: { headerFrom: domain },
          authResults: {
            dkim: [{ domain, result: "pass" }],
            spf: [{ domain, result: "pass" }],
          },
        },
      ],
    },
  };
}

describe("consumer handler", () => {
  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({});
  });

  it("persists valid events to DynamoDB", async () => {
    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([makeValidEventBody()]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("reports batch item failure for invalid records", async () => {
    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([{ invalid: "data" }]);
    const result = await handler(event);

    expect(result.batchItemFailures.length).toBe(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe("msg-0");
  });

  it("reports all records as failures when DynamoDB write fails", async () => {
    sendMock.mockRejectedValueOnce(new Error("DynamoDB error"));

    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([makeValidEventBody(), makeValidEventBody()]);
    const result = await handler(event);

    expect(result.batchItemFailures.length).toBe(2);
  });

  it("handles mixed valid and invalid records", async () => {
    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([makeValidEventBody(), { bad: "record" }]);
    const result = await handler(event);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(result.batchItemFailures.length).toBe(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe("msg-1");
  });

  it("upserts domain aggregates after persisting reports", async () => {
    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([makeValidEventBody()]);
    await handler(event);

    expect(sendMock).toHaveBeenCalledTimes(2);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
    const calls = sendMock.mock.calls as unknown as Array<Array<{ input: unknown }>>;
    expect(calls[1]?.[0]?.input).toEqual({
      TableName: "test-table",
      Key: { pk: "domain#example.org", sk: "domain" },
      UpdateExpression:
        "SET #domain = :domain ADD #totalMessages :msgs, #totalPass :pass, #totalFail :fail",
      ExpressionAttributeNames: {
        "#domain": "domain",
        "#totalMessages": "totalMessages",
        "#totalPass": "totalPass",
        "#totalFail": "totalFail",
      },
      ExpressionAttributeValues: {
        ":domain": "example.org",
        ":msgs": 5,
        ":pass": 5,
        ":fail": 0,
      },
    });
  });

  it("aggregates multiple reports for the same domain", async () => {
    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([
      makeValidEventBody("example.org"),
      makeValidEventBody("example.org"),
    ]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(sendMock).toHaveBeenCalledTimes(2);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:test mock calls are untyped; narrowing confirms shape
    const calls = sendMock.mock.calls as unknown as Array<Array<{ input: unknown }>>;
    expect(calls[1]?.[0]?.input).toEqual({
      TableName: "test-table",
      Key: { pk: "domain#example.org", sk: "domain" },
      UpdateExpression:
        "SET #domain = :domain ADD #totalMessages :msgs, #totalPass :pass, #totalFail :fail",
      ExpressionAttributeNames: {
        "#domain": "domain",
        "#totalMessages": "totalMessages",
        "#totalPass": "totalPass",
        "#totalFail": "totalFail",
      },
      ExpressionAttributeValues: {
        ":domain": "example.org",
        ":msgs": 10,
        ":pass": 10,
        ":fail": 0,
      },
    });
  });

  it("continues even if domain upsert fails", async () => {
    sendMock.mockResolvedValueOnce({});
    sendMock.mockRejectedValueOnce(new Error("UpdateCommand failed"));

    const { handler } = await import("../src/consumer.ts");

    const event = makeSqsEvent([makeValidEventBody()]);
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
  });
});
