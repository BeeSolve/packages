import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { Nodejs24Function, parseHandlerName } from "../src/nodejsFunction";

describe("parseHandlerName", () => {
  test("derives handler from a simple .ts entry", () => {
    expect(parseHandlerName("lambda.ts")).toBe("lambda.handler");
  });

  test("strips the directory prefix", () => {
    expect(parseHandlerName("src/handlers/api.ts")).toBe("api.handler");
  });

  test("handles absolute paths", () => {
    expect(parseHandlerName("/home/user/project/src/worker.ts")).toBe("worker.handler");
  });

  test("handles kebab-case filenames", () => {
    expect(parseHandlerName("src/send-email.ts")).toBe("send-email.handler");
  });

  test("strips only the final extension", () => {
    expect(parseHandlerName("src/my.service.ts")).toBe("my.service.handler");
  });
});

describe("Nodejs24Function", () => {
  let prebuiltDir: string;

  beforeAll(() => {
    prebuiltDir = mkdtempSync(join(tmpdir(), "cdk-fn-test-"));
    mkdirSync(prebuiltDir, { recursive: true });
    writeFileSync(join(prebuiltDir, "index.mjs"), "export const handler = async () => {};");
  });

  test("throws when using prebuilt entry without a handler", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    expect(() => {
      new Nodejs24Function(stack, "Fn", { entry: `${prebuiltDir}/` });
    }).toThrow('Missing "handler"');
  });

  test("creates a Lambda function and log group for prebuilt directory entry", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Nodejs24Function(stack, "Fn", {
      entry: `${prebuiltDir}/`,
      handler: "index.handler",
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
  });

  test("uses ARM64 architecture by default", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Nodejs24Function(stack, "Fn", {
      entry: `${prebuiltDir}/`,
      handler: "index.handler",
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
    });
  });

  test("uses JSON logging format by default", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Nodejs24Function(stack, "Fn", {
      entry: `${prebuiltDir}/`,
      handler: "index.handler",
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      LoggingConfig: { LogFormat: "JSON" },
    });
  });

  test("applies the provided handler to the function", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Nodejs24Function(stack, "Fn", {
      entry: `${prebuiltDir}/`,
      handler: "custom.myFunction",
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Handler: "custom.myFunction",
    });
  });
});
