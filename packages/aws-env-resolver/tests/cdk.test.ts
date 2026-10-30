import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { App, Stack } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";

import { generate, generateAndPersist, persist, traceEnv } from "../cdk.ts";
import type { EmittedTarget } from "../src/emit.ts";
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

function only(config: { readonly targets: Record<string, EmittedTarget> }): EmittedTarget {
  const target = config.targets.default;
  if (target == null) {
    throw new Error("expected a default target");
  }
  return target;
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
  traceEnv(stack);
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
    const target = only(config);
    expect(target.resources).toContainEqual({
      envVar: "DATA_TABLE_NAME",
      logicalIdPrefix: expectedPrefix,
    });
    expect(target.config.staticEnv.BASE_URI).toBe("https://example.test");
    expect(target.config.stackName).toBe("example-stack");
    expect(target.config.region).toBe("eu-central-1");
    expect(target.config.secretId).toBe("example/secrets");
    expect(target.secrets).toEqual([{ envVar: "API_KEY" }]);
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
    const loaded = await loadConfig({ cwd: dir, stage: "staging" });

    expect(loaded.projectKey).toBe(config.projectKey);
    expect(loaded.config).toEqual(only(config).config);
    expect(loaded.resources).toEqual(only(config).resources);
    expect(loaded.secrets).toEqual(only(config).secrets);
    expect(loaded.target).toBeUndefined();
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
    traceEnv(otherStack);
    const queue = new sqs.Queue(otherStack, "Jobs");
    addFunction({
      stack: otherStack,
      id: "OtherHandler",
      environment: { QUEUE_URL: queue.queueUrl },
    });
    const noEnvStack = new Stack(app, "NoEnvStack", {
      env: { region: "us-east-1", account: "111122223333" },
    });
    traceEnv(noEnvStack);
    addFunction({ stack: noEnvStack, id: "EdgeHandler", environment: {} });

    const config = generate({ projectName: "example-app", scope: app });

    expect(only(config).config.stackName).toEqual(["example-stack", "other-stack"]);
    expect(only(config).resources).toEqual(
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
    traceEnv(otherStack);
    addFunction({ stack: otherStack, id: "OtherHandler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(/multiple regions/);
  });

  it("writes to aws-env.config.<stage>.json when a stage is given", () => {
    const { app } = buildApp();
    const dir = makeTempDir();
    const previous = process.cwd();
    process.chdir(dir);
    try {
      generateAndPersist({ projectName: "example-app", stage: "stg", scope: app });
    } finally {
      process.chdir(previous);
    }

    expect(existsSync(join(dir, "aws-env.config.stg.json"))).toBe(true);
    expect(existsSync(join(dir, "aws-env.config.json"))).toBe(false);
  });

  it("rejects a stage that is unsafe in file names", () => {
    const { app } = buildApp();

    expect(() =>
      generateAndPersist({ projectName: "example-app", stage: "../prod", scope: app }),
    ).toThrow(/stage must start with a letter or digit/);
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
    traceEnv(edgeStack);
    addFunction({ stack: edgeStack, id: "EdgeHandler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(/multiple regions/);
    const config = generate({ projectName: "example-app", scope: [stack] });
    expect(only(config).config.stackName).toBe("example-stack");
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

    expect(only(config).config.staticEnv.EVENT_BUS_ARN).toBe(
      "arn:aws:events:eu-central-1:111122223333:event-bus/default",
    );
  });

  it("throws for env-agnostic stacks", () => {
    const app = new App();
    const stack = new Stack(app, "AgnosticStack");
    traceEnv(stack);
    addFunction({ stack, id: "Handler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(/unresolved region/);
  });

  it("throws when nothing is marked with traceEnv", () => {
    const app = new App();
    const stack = new Stack(app, "Stack", { env: { region: "eu-central-1" } });
    addFunction({ stack, id: "Handler", environment: { A: "b" } });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(
      /No constructs marked with traceEnv/,
    );
  });

  it("throws when a traced construct contains no lambda function", () => {
    const app = new App();
    const stack = new Stack(app, "EmptyStack", {
      env: { region: "eu-central-1", account: "111122223333" },
    });
    traceEnv(stack);

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(
      /contains no Lambda function/,
    );
  });
});

describe("traceEnv", () => {
  it("traces only the marked construct, leaving other lambdas out", () => {
    const { app, stack } = buildApp();
    const untraced = new Stack(app, "Untraced", {
      env: { region: "us-east-1", account: "111122223333" },
      stackName: "untraced",
    });
    addFunction({ stack: untraced, id: "Other", environment: { DATA_TABLE_NAME: "other" } });

    const config = generate({ projectName: "example-app", scope: app });

    expect(only(config).config.stackName).toBe(stack.stackName);
  });

  it("finds lambdas inside a marked construct and accepts a lambda directly", () => {
    const app = new App();
    const stack = new Stack(app, "Stack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "example-stack",
    });
    const handler = addFunction({ stack, id: "Handler", environment: { A: "a" } });
    addFunction({ stack, id: "Unrelated", environment: { B: "b" } });
    traceEnv(handler);

    const config = generate({ projectName: "example-app", scope: app });

    expect(only(config).config.staticEnv).toEqual({ A: "a" });
  });

  it("keeps targets apart so one env var can differ per target", () => {
    const app = new App();
    const stack = new Stack(app, "Stack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "example-stack",
    });
    const webTable = new dynamodb.Table(stack, "WebTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
    });
    const workerTable = new dynamodb.Table(stack, "WorkerTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
    });
    const web = addFunction({ stack, id: "Web", environment: { TABLE: webTable.tableName } });
    const worker = addFunction({
      stack,
      id: "Worker",
      environment: { TABLE: workerTable.tableName },
    });
    traceEnv(web, { target: "web" });
    traceEnv(worker, { target: "worker" });

    const config = generate({ projectName: "example-app", scope: app });

    expect(Object.keys(config.targets).toSorted()).toEqual(["web", "worker"]);
    expect(config.targets.web?.resources).toEqual([
      { envVar: "TABLE", logicalIdPrefix: "WebTable" },
    ]);
    expect(config.targets.worker?.resources).toEqual([
      { envVar: "TABLE", logicalIdPrefix: "WorkerTable" },
    ]);
  });

  it("still reports a conflict inside one target and names the target", () => {
    const app = new App();
    const stack = new Stack(app, "Stack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "example-stack",
    });
    const first = new dynamodb.Table(stack, "First", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
    });
    const second = new dynamodb.Table(stack, "Second", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
    });
    traceEnv(addFunction({ stack, id: "One", environment: { TABLE: first.tableName } }), {
      target: "web",
    });
    traceEnv(addFunction({ stack, id: "Two", environment: { TABLE: second.tableName } }), {
      target: "web",
    });

    expect(() => generate({ projectName: "example-app", scope: app })).toThrow(
      /Target "web": Conflicting values for env var TABLE/,
    );
  });

  it("puts a construct in several targets and merges repeated calls", () => {
    const app = new App();
    const stack = new Stack(app, "Stack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "example-stack",
    });
    const shared = addFunction({ stack, id: "Shared", environment: { A: "a" } });
    traceEnv(shared, { target: ["web", "worker"] });
    traceEnv(shared, { target: "other" });

    const config = generate({ projectName: "example-app", scope: app });

    expect(Object.keys(config.targets).toSorted()).toEqual(["other", "web", "worker"]);
  });

  it("rejects an unsafe target name", () => {
    const { stack } = buildApp();

    expect(() => traceEnv(stack, { target: "../web" })).toThrow(/target must start/);
  });

  it("round-trips named targets through the json loader and selects one", async () => {
    const app = new App();
    const stack = new Stack(app, "Stack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "example-stack",
    });
    traceEnv(addFunction({ stack, id: "Web", environment: { A: "web" } }), { target: "web" });
    traceEnv(addFunction({ stack, id: "Worker", environment: { A: "worker" } }), {
      target: "worker",
    });
    const dir = makeTempDir();
    persist(generate({ projectName: "example-app", scope: app }), {
      path: join(dir, "aws-env.config.json"),
    });

    const web = await loadConfig({ cwd: dir, target: "web" });
    const worker = await loadConfig({ cwd: dir, target: "worker" });

    expect(web.config.staticEnv).toEqual({ A: "web" });
    expect(web.target).toBe("web");
    expect(worker.config.staticEnv).toEqual({ A: "worker" });
    expect(await loadErrorMessage({ cwd: dir })).toMatch(/several targets \(web, worker\)/);
    expect(await loadErrorMessage({ cwd: dir, target: "nope" })).toMatch(
      /Target "nope" not found.*Available: web, worker/,
    );
  });

  it("loads the only target without a flag", async () => {
    const app = new App();
    const stack = new Stack(app, "Stack", {
      env: { region: "eu-central-1", account: "111122223333" },
      stackName: "example-stack",
    });
    traceEnv(addFunction({ stack, id: "Web", environment: { A: "web" } }), { target: "web" });
    const dir = makeTempDir();
    persist(generate({ projectName: "example-app", scope: app }), {
      path: join(dir, "aws-env.config.json"),
    });

    const loaded = await loadConfig({ cwd: dir });

    expect(loaded.target).toBe("web");
  });
});

async function loadErrorMessage(props: {
  readonly cwd: string;
  readonly target?: string;
}): Promise<string | undefined> {
  try {
    await loadConfig(props);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
