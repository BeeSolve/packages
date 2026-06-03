import { describe, expect, test } from "bun:test";

import { App, Duration, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";

import { EmailAlarms } from "../index";

const EMAIL = "alerts@example.com";

function makeStack() {
  const app = new App();
  return new Stack(app, "TestStack");
}

function makeLambda(stack: Stack) {
  return new Function(stack, "Fn", {
    runtime: Runtime.NODEJS_24_X,
    code: Code.fromInline("exports.handler = async () => {}"),
    handler: "index.handler",
  });
}

function makeQueues(stack: Stack) {
  const queue = new Queue(stack, "Queue");
  const dlq = new Queue(stack, "Dlq");
  return { queue, dlq };
}

describe("EmailAlarms.reportLambdaErrors", () => {
  test("creates one SNS topic", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    alarms.reportLambdaErrors(makeLambda(stack));
    Template.fromStack(stack).resourceCountIs("AWS::SNS::Topic", 1);
  });

  test("subscribes the provided email address", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    alarms.reportLambdaErrors(makeLambda(stack));
    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: EMAIL,
    });
  });

  test("creates an error alarm with threshold 1 and ignore missing data", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    alarms.reportLambdaErrors(makeLambda(stack));
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 1,
      EvaluationPeriods: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "ignore",
    });
  });

  test("wires both alarm and ok actions to the topic", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    alarms.reportLambdaErrors(makeLambda(stack));
    const template = Template.fromStack(stack);
    const alarmResources = template.findResources("AWS::CloudWatch::Alarm");
    const alarm = Object.values(alarmResources)[0];
    const properties = alarm?.Properties ?? {};
    const okActions: unknown[] = properties.OKActions ?? [];
    const alarmActions: unknown[] = properties.AlarmActions ?? [];
    expect(okActions).toHaveLength(1);
    expect(alarmActions).toHaveLength(1);
  });
});

describe("EmailAlarms.reportSqsErrors", () => {
  test("creates one topic and one alarm when no optional periods are given", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  test("DLQ alarm uses threshold 1 and ignore missing data", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq });
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 1,
      EvaluationPeriods: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "ignore",
    });
  });

  test("noMessagesPeriod adds a second topic and a NoMessages alarm", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq, noMessagesPeriod: Duration.hours(1) });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Topic", 2);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });

  test("noMessagesPeriod alarm uses LessThanOrEqualToThreshold and breaching missing data", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq, noMessagesPeriod: Duration.hours(1) });
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 0,
      ComparisonOperator: "LessThanOrEqualToThreshold",
      TreatMissingData: "breaching",
    });
  });

  test("noConsumersPeriod adds a second topic and a NoConsumers alarm", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq, noConsumersPeriod: Duration.hours(2) });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Topic", 2);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });

  test("noConsumersPeriod alarm uses LessThanOrEqualToThreshold and breaching missing data", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq, noConsumersPeriod: Duration.hours(2) });
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 0,
      ComparisonOperator: "LessThanOrEqualToThreshold",
      TreatMissingData: "breaching",
    });
  });

  test("both optional periods share one queue topic and produce three alarms total", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({
      queue,
      dlq,
      noMessagesPeriod: Duration.hours(1),
      noConsumersPeriod: Duration.hours(2),
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::Topic", 2);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  test("subscribes email to DLQ topic", () => {
    const stack = makeStack();
    const alarms = new EmailAlarms(stack, "Alarms", { emailAddress: EMAIL });
    const { queue, dlq } = makeQueues(stack);
    alarms.reportSqsErrors({ queue, dlq });
    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: EMAIL,
    });
  });
});
