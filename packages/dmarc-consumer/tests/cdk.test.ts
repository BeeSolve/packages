import { beforeAll, describe, it } from "bun:test";
import { mkdirSync } from "node:fs";

import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { DmarcConsumer } from "../cdk.ts";

beforeAll(() => {
  mkdirSync(new URL("../consumer", import.meta.url), { recursive: true });
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
        "detail-type": ["DmarcReportParsed"],
      },
    });
  });
});
