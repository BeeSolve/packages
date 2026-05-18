import { App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { describe, expect, test } from "bun:test";
import { SqsWithDlq } from "../src/sqsWithDlq";

function makeStack() {
  const app = new App();
  return new Stack(app, "TestStack");
}

function makeLambda(stack: Stack, timeout?: Duration) {
  return new Function(stack, "Fn", {
    runtime: Runtime.NODEJS_24_X,
    code: Code.fromInline("exports.handler = async () => {}"),
    handler: "index.handler",
    ...(timeout != null && { timeout }),
  });
}

describe("SqsWithDlq", () => {
  test("creates a queue and a DLQ", () => {
    const stack = makeStack();
    new SqsWithDlq(stack, "Sqs");
    Template.fromStack(stack).resourceCountIs("AWS::SQS::Queue", 2);
  });

  test("enables SSL enforcement on both queues", () => {
    const stack = makeStack();
    new SqsWithDlq(stack, "Sqs");
    const template = Template.fromStack(stack);
    const queues = template.findResources("AWS::SQS::Queue");
    const queueList = Object.values(queues);
    expect(queueList).toHaveLength(2);
    for (const queue of queueList) {
      expect(queue.Properties.SqsManagedSseEnabled).toBe(true);
    }
  });

  test("FIFO settings propagate from queue to DLQ", () => {
    const stack = makeStack();
    new SqsWithDlq(stack, "Sqs", {
      queue: { fifo: true, contentBasedDeduplication: true },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SQS::Queue", 2);
    const queues = template.findResources("AWS::SQS::Queue");
    for (const queue of Object.values(queues)) {
      expect(queue.Properties.FifoQueue).toBe(true);
    }
  });

  test("asLambdaInput sets visibility timeout to 6× the lambda timeout", () => {
    const stack = makeStack();
    const lambda = makeLambda(stack, Duration.seconds(10));
    SqsWithDlq.asLambdaInput({ lambda });
    Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 60,
    });
  });

  test("asLambdaInput uses default 3s timeout when lambda timeout is unset", () => {
    const stack = makeStack();
    const lambda = makeLambda(stack);
    SqsWithDlq.asLambdaInput({ lambda });
    Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 18,
    });
  });

  test("asLambdaInput caps visibility timeout at 12 hours and warns", () => {
    const stack = makeStack();
    const lambda = makeLambda(stack, Duration.hours(3));
    SqsWithDlq.asLambdaInput({ lambda });

    Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 43200,
    });
    Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp("capped at 12 hours"));
  });

  test("asLambdaInput wires the SQS event source to the lambda", () => {
    const stack = makeStack();
    const lambda = makeLambda(stack, Duration.seconds(30));
    SqsWithDlq.asLambdaInput({ lambda });
    Template.fromStack(stack).resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  test("asLambdaInput disabled flag creates a disabled event source", () => {
    const stack = makeStack();
    const lambda = makeLambda(stack, Duration.seconds(10));
    SqsWithDlq.asLambdaInput({ lambda, disabled: true });
    Template.fromStack(stack).hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      { Enabled: false },
    );
  });
});
