import { beforeAll, describe, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { DmarcConsumer } from "../cdk.ts";

beforeAll(() => {
  mkdirSync(new URL("../consumer", import.meta.url), { recursive: true });
  mkdirSync(new URL("../tasks", import.meta.url), { recursive: true });
  mkdirSync(new URL("../dnsCron", import.meta.url), { recursive: true });
});

function makeStack() {
  const app = new App();
  return new Stack(app, "TestStack", {
    env: { account: "123456789012", region: "us-east-1" },
  });
}

describe("DmarcConsumer construct", () => {
  it("creates a table with pk partition key and sk sort key", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    });
  });

  it("creates a table with onDemand billing", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("creates a reverse GSI with sk as partition key and pk as sort key", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "reverse",
          KeySchema: [
            { AttributeName: "sk", KeyType: "HASH" },
            { AttributeName: "pk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        }),
      ]),
    });
  });

  it("creates a consumer Lambda with TABLE_NAME and REVERSE_INDEX_NAME environment variables", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          REVERSE_INDEX_NAME: "reverse",
        }),
      },
    });
  });

  it("creates an EventBridge rule with correct event pattern", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["dmarc-reports"],
        "detail-type": ["DmarcReportParsed", "DmarcProcessingStats"],
      },
    });
  });

  it("creates a backfill worker Lambda with a 5 minute timeout", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 300,
    });
  });

  it("creates a backfill queue with a dead-letter queue in addition to the ingestion queues", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SQS::Queue", 4);
  });

  it("grantBackfill adds the queue-url env and send-message permission to a passed Lambda", () => {
    const stack = makeStack();
    const consumer = new DmarcConsumer(stack, "Consumer");

    const consumerEntry = fileURLToPath(new URL("../consumer/", import.meta.url));
    const grantee = new Nodejs24Function(stack, "Grantee", {
      entry: `${consumerEntry}/`,
      handler: "consumer.handler",
      memorySize: 128,
      timeout: Duration.seconds(10),
    });
    consumer.grantBackfill(grantee);

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          BEESOLVE_TASKS_MAIN_QUEUE_URL: Match.anyValue(),
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["sqs:SendMessage"]),
          }),
        ]),
      },
    });
  });

  it("grants the consumer Lambda tasks-queue enqueue access and the queue-url env", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "consumer.handler",
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          REVERSE_INDEX_NAME: "reverse",
          BEESOLVE_TASKS_MAIN_QUEUE_URL: Match.anyValue(),
        }),
      },
    });
  });

  it("creates a daily EventBridge schedule for the DNS refresh cron", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 day)",
    });
  });

  it("creates a DNS cron Lambda with table read and tasks-queue enqueue access", () => {
    const stack = makeStack();
    new DmarcConsumer(stack, "Consumer");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "dnsCron.handler",
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          REVERSE_INDEX_NAME: "reverse",
          BEESOLVE_TASKS_MAIN_QUEUE_URL: Match.anyValue(),
        }),
      },
    });
  });
});
