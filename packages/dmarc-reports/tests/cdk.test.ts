import { beforeAll, describe, it } from "bun:test";
import { mkdirSync } from "node:fs";

import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { DmarcReports } from "../cdk.ts";

beforeAll(() => {
  mkdirSync(new URL("../handler", import.meta.url), { recursive: true });
});

function makeStack() {
  const app = new App();
  return new Stack(app, "TestStack", {
    env: { account: "123456789012", region: "us-east-1" },
  });
}

describe("DmarcReports construct", () => {
  it("creates an S3 bucket with lifecycle and SSL enforcement", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            ExpirationInDays: 90,
            Status: "Enabled",
          }),
        ]),
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("enables EventBridge notifications on the bucket", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.resourceCountIs("Custom::S3BucketNotifications", 1);
  });

  it("creates SES receipt rule with S3 action and scan enabled", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SES::ReceiptRule", {
      Rule: Match.objectLike({
        Recipients: ["dmarc@example.com"],
        ScanEnabled: true,
        Actions: Match.arrayWith([
          Match.objectLike({
            S3Action: Match.objectLike({
              ObjectKeyPrefix: "inbox/",
            }),
          }),
        ]),
      }),
    });
  });

  it("creates a Lambda function with EVENT_BUS_NAME environment variable", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Environment: {
        Variables: Match.objectLike({
          EVENT_BUS_ARN: "arn:aws:events:us-east-1:123456789012:event-bus/default",
        }),
      },
    });
  });

  it("creates an EventBridge rule targeting the Lambda", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws.s3"],
        "detail-type": ["Object Created"],
      },
    });
  });

  it("grants S3 read to Lambda", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["s3:GetObject*"]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("grants EventBridge PutEvents with specific region/account ARN", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "events:PutEvents",
            Effect: "Allow",
            Resource: "arn:aws:events:us-east-1:123456789012:event-bus/default",
          }),
        ]),
      },
    });
  });

  it("uses custom event bus ARN when provided", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", {
      recipient: "dmarc@example.com",
      eventBusArn: "arn:aws:events:us-east-1:123456789012:event-bus/custom-bus",
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          EVENT_BUS_ARN: "arn:aws:events:us-east-1:123456789012:event-bus/custom-bus",
        }),
      },
    });
  });

  it("applies handlerProps overrides", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", {
      recipient: "dmarc@example.com",
      handlerProps: {
        memorySize: 512,
        timeout: Duration.seconds(60),
      },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 512,
      Timeout: 60,
    });
  });

  it("creates LambdaKeepActive construct", () => {
    const stack = makeStack();
    new DmarcReports(stack, "Dmarc", { recipient: "dmarc@example.com" });

    const template = Template.fromStack(stack);
    // The keep-active construct creates a scheduled rule
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(3 days)",
    });
  });
});
