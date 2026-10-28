import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { App, Stack } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";

import { generate, generateAndPersist, persist } from "../cdk.ts";
import { loadConfig } from "../src/loadConfig.ts";

const tempDirs: Array<string> = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aws-env-cdk-"));
  tempDirs.push(dir);
  return dir;
}

function addFunction(props: {
  readonly stack: Stack;
  readonly id: string;
  readonly environment: Record<string, string>;
}): lambda.Function {
  return new lambda.Function(props.stack, props.id, {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
    environment: props.environment,
  });
}

function buildApp(): { readonly app: App; readonly stack: Stack; readonly table: dynamodb.Table } {
  const app = new App();
  const stack = new Stack(app, "ExampleStack", {
    env: { region: "eu-central-1", account: "111122223333" },
    stackName: "example-stack",
  });
  const table = new dynamodb.Table(stack, "Data", {
    partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
  });
  addFunction({
    stack,
    id: "Handler",
    environment: { DATA_TABLE_NAME: table.tableName, BASE_URI: "https://example.test" },
  });
  return { app, stack, table };
}

describe("generate", () => {
  it("emits the mapping from a real CDK app", () => {
    const { app, stack, table } = buildApp();
    const tableResource = table.node.defaultChild;
    if (!(tableResource instanceof dynamodb.CfnTable)) {
      throw new Error("expected CfnTable default child");
    }
    const expectedPrefix = stack.getLogicalId(tableResource).replace(/[0-9A-F]{8}$/, "");

    const config = generate({
      projectName: "example-app",
      scope: app,
      secrets: [{ secretId: "example/secrets", envVars: ["API_KEY"] }],
    });

    expect(expectedPrefix.startsWith("Data")).toBe(true);
    expect(config.projectKey).toBe("example-app");
    expect(config.resources).toContainEqual({
      envVar: "DATA_TABLE_NAME",
      logicalIdPrefix: expectedPrefix,
    });
    expect(config.config.staticEnv.BASE_URI).toBe("https://example.test");
    expect(config.config.stackName).toBe("example-stack");
    expect(config.config.region).toBe("eu-central-1");
    expect(config.config.secretId).toBe("example/secrets");
    expect(config.secrets).toEqual([{ envVar: "API_KEY" }]);
  });

  it("round-trips a persisted config through the CLI json loader", async () => {
    const { app } = buildApp();
    const config = generate({
      projectName: "example-app",
      scope: app,
      secrets: [{ secretId: "example/secrets", envVars: ["API_KEY"] }],
    });
    const dir = makeTempDir();
    const path = join(dir, "aws-env.config.json");

    persist(config, { path });
    const loaded = await loadConfig({ cwd: dir, namespace: "staging" });

    expect(loaded.projectKey).toBe(config.projectKey);
    expect(loaded.config).toEqual(config.config);
    expect(loaded.resources).toEqual(config.resources);
    expect(loaded.secrets).toEqual(config.secrets);
  });

  it("generateAndPersist writes nested paths and returns the config", () => {
    const { app } = buildApp();
    const path = join(makeTempDir(), "nested", "aws-env.config.json");

    const config = generateAndPersist({
      projectName: "example-app",
      scope: app,
      path,
    });

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(config);
  });

  it("emits every stack with lambda env and tags resource mappings with their stack", () => {
    const { app } = buildApp();
    const otherStack = new Stack(app, "OtherStack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "other-stack",
    });
    const queue = new sqs.Queue(otherStack, "Jobs");
    addFunction({
      stack: otherStack,
      id: "OtherHandler",
      environment: { QUEUE_URL: queue.queueUrl },
    });
    const noEnvStack = new Stack(app, "NoEnvStack", {
      env: { region: "us-east-1", account: "111122223333" },
    });
    addFunction({ stack: noEnvStack, id: "EdgeHandler", environment: {} });

    const config = generate({ projectName: "example-app", scope: app });

    expect(config.config.stackName).toEqual(["example-stack", "other-stack"]);
    expect(config.resources).toEqual(
      expect.arrayContaining([
        { envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data", stackName: "example-stack" },
        { envVar: "QUEUE_URL", logicalIdPrefix: "Jobs", stackName: "other-stack" },
      ]),
    );
  });

  it("throws when stacks with lambda env span multiple regions", () => {
    const { app } = buildApp();
    const otherStack = new Stack(app, "OtherStack", {
      env: { region: "us-east-1", account: "111122223333" },
      stackName: "other-stack",
    });
    addFunction({ stack: otherStack, id: "OtherHandler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(/multiple regions/);
  });

  it("writes to aws-env.config.json in the cwd by default", () => {
    const { app } = buildApp();
    const dir = makeTempDir();
    const previous = process.cwd();
    process.chdir(dir);
    try {
      generateAndPersist({ projectName: "example-app", scope: app });
    } finally {
      process.chdir(previous);
    }

    expect(JSON.parse(readFileSync(join(dir, "aws-env.config.json"), "utf8")).projectKey).toBe(
      "example-app",
    );
  });

  it("limits the walk to the stacks given as scope", () => {
    const { app, stack } = buildApp();
    const edgeStack = new Stack(app, "EdgeStack", {
      env: { region: "us-east-1", account: "111122223333" },
      stackName: "edge-stack",
    });
    addFunction({ stack: edgeStack, id: "EdgeHandler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(/multiple regions/);
    const config = generate({ projectName: "example-app", scope: [stack] });
    expect(config.config.stackName).toBe("example-stack");
  });

  it("inlines pseudo parameters so a literal ARN becomes static env", () => {
    const { app, stack } = buildApp();
    addFunction({
      stack,
      id: "Bus",
      environment: {
        EVENT_BUS_ARN: stack.formatArn({
          service: "events",
          resource: "event-bus",
          resourceName: "default",
        }),
      },
    });

    const config = generate({ projectName: "example-app", scope: app });

    expect(config.config.staticEnv.EVENT_BUS_ARN).toBe(
      "arn:aws:events:eu-central-1:111122223333:event-bus/default",
    );
  });

  it("throws for env-agnostic stacks", () => {
    const app = new App();
    const stack = new Stack(app, "AgnosticStack");
    addFunction({ stack, id: "Handler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(/unresolved region/);
  });

  it("throws when no lambda functions exist", () => {
    const app = new App();
    new Stack(app, "EmptyStack", { env: { region: "eu-central-1", account: "111122223333" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(
      /No Lambda functions/,
    );
  });
});
