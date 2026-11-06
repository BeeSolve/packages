import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { App, Stack } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";

import { envOf, generateDevEnv, devEnv, persistDevEnv, secret } from "../cdk.ts";
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

function addStack(app: App, id: string, region = "eu-central-1"): Stack {
  return new Stack(app, id, {
    env: { region, account: "111122223333" },
    stackName: id.toLowerCase(),
  });
}

function addTable(stack: Stack, id: string): dynamodb.Table {
  return new dynamodb.Table(stack, id, {
    partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
  });
}

function only(config: { readonly targets: Record<string, EmittedTarget> }): EmittedTarget {
  const target = config.targets.default;
  if (target == null) {
    throw new Error("expected a default target");
  }
  return target;
}

function buildApp(): {
  readonly app: App;
  readonly stack: Stack;
  readonly handler: lambda.Function;
} {
  const app = new App();
  const stack = addStack(app, "ExampleStack");
  const table = addTable(stack, "Data");
  const handler = addFunction({
    stack,
    id: "Handler",
    environment: { DATA_TABLE_NAME: table.tableName, BASE_URI: "https://example.test" },
  });
  return { app, stack, handler };
}

describe("generateDevEnv", () => {
  it("emits resources, literals and secrets from the composed env", () => {
    const { handler } = buildApp();

    const config = generateDevEnv({
      projectName: "example-app",
      profile: "example-profile",
      env: {
        ...envOf(handler),
        BASE_URI: "https://local.test:3000",
        IS_LOCAL: "true",
        API_KEY: secret({ secretId: "example/secrets" }),
        SIGNING: secret({ secretId: "example/secrets", jsonKey: "signingKey" }),
      },
    });

    const target = only(config);
    expect(config.projectKey).toBe("example-app");
    expect(target.resources).toEqual([{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }]);
    expect(target.config.staticEnv).toEqual({
      BASE_URI: "https://local.test:3000",
      IS_LOCAL: "true",
    });
    expect(target.config.stackName).toBe("examplestack");
    expect(target.config.region).toBe("eu-central-1");
    expect(target.config.profile).toBe("example-profile");
    expect(target.config.secretId).toBe("example/secrets");
    expect(target.secrets).toEqual([
      { envVar: "API_KEY" },
      { envVar: "SIGNING", jsonKey: "signingKey" },
    ]);
  });

  it("lets later spreads win, so the app's resource beats an embedded one", () => {
    const app = new App();
    const stack = addStack(app, "Stack");
    const appQueue = new sqs.Queue(stack, "AppQueue");
    const authQueue = new sqs.Queue(stack, "AuthQueue");
    const appHandler = addFunction({ stack, id: "App", environment: { QUEUE: appQueue.queueUrl } });
    const authHandler = addFunction({
      stack,
      id: "Auth",
      environment: { QUEUE: authQueue.queueUrl },
    });

    const config = generateDevEnv({
      projectName: "example-app",
      env: { ...envOf(authHandler), ...envOf(appHandler) },
    });

    expect(only(config).resources).toEqual([{ envVar: "QUEUE", logicalIdPrefix: "AppQueue" }]);
  });

  it("emits every stack and tags resource mappings with their stack", () => {
    const { app, handler } = buildApp();
    const otherStack = addStack(app, "OtherStack");
    const queue = new sqs.Queue(otherStack, "Jobs");
    const other = addFunction({
      stack: otherStack,
      id: "OtherHandler",
      environment: { QUEUE_URL: queue.queueUrl },
    });

    const config = generateDevEnv({
      projectName: "example-app",
      env: { ...envOf(handler), ...envOf(other) },
    });

    expect(only(config).config.stackName).toEqual(["examplestack", "otherstack"]);
    expect(only(config).resources).toEqual(
      expect.arrayContaining([
        { envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data", stackName: "examplestack" },
        { envVar: "QUEUE_URL", logicalIdPrefix: "Jobs", stackName: "otherstack" },
      ]),
    );
  });

  it("throws when the env spans multiple regions", () => {
    const { app, handler } = buildApp();
    const other = addFunction({
      stack: addStack(app, "OtherStack", "us-east-1"),
      id: "OtherHandler",
      environment: { A: "b" },
    });
    const queue = new sqs.Queue(other.stack, "Jobs");
    const withQueue = addFunction({
      stack: Stack.of(other),
      id: "Queue",
      environment: { QUEUE_URL: queue.queueUrl },
    });

    expect(() =>
      generateDevEnv({
        projectName: "example-app",
        env: { ...envOf(handler), ...envOf(withQueue) },
      }),
    ).toThrow(/multiple regions/);
  });

  it("throws when the env has no value from envOf", () => {
    expect(() => generateDevEnv({ projectName: "example-app", env: { A: "b" } })).toThrow(
      /no value from envOf/,
    );
  });

  it("inlines pseudo parameters so a literal ARN becomes static env", () => {
    const { stack, handler } = buildApp();
    const bus = addFunction({
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

    const config = generateDevEnv({
      projectName: "example-app",
      env: { ...envOf(handler), ...envOf(bus) },
    });

    expect(only(config).config.staticEnv.EVENT_BUS_ARN).toBe(
      "arn:aws:events:eu-central-1:111122223333:event-bus/default",
    );
  });

  it("emits dynamic secret references on a Lambda as secret mappings", () => {
    const { stack, handler } = buildApp();
    const withSecret = addFunction({
      stack,
      id: "WithSecret",
      environment: { TOKEN: "{{resolve:secretsmanager:example/secrets:SecretString:token::}}" },
    });

    const config = generateDevEnv({
      projectName: "example-app",
      env: { ...envOf(handler), ...envOf(withSecret) },
    });

    expect(only(config).secrets).toEqual([{ envVar: "TOKEN", jsonKey: "token" }]);
    expect(only(config).config.secretId).toBe("example/secrets");
  });
});

describe("envOf", () => {
  it("finds lambdas inside a construct and accepts a lambda directly", () => {
    const app = new App();
    const stack = addStack(app, "Stack");
    const handler = addFunction({ stack, id: "Handler", environment: { A: "a" } });
    addFunction({ stack, id: "Unrelated", environment: { B: "b" } });

    expect(envOf(handler)).toEqual({ A: "a" });
    expect(envOf(stack)).toEqual({ A: "a", B: "b" });
  });

  it("merges identical values from several lambdas under one construct", () => {
    const app = new App();
    const stack = addStack(app, "Stack");
    const table = addTable(stack, "Data");
    addFunction({ stack, id: "One", environment: { TABLE: table.tableName } });
    addFunction({ stack, id: "Two", environment: { TABLE: table.tableName } });

    expect(Object.keys(envOf(stack))).toEqual(["TABLE"]);
  });

  it("names both lambdas when they disagree", () => {
    const app = new App();
    const stack = addStack(app, "Stack");
    addFunction({ stack, id: "One", environment: { TABLE: addTable(stack, "First").tableName } });
    addFunction({ stack, id: "Two", environment: { TABLE: addTable(stack, "Second").tableName } });

    expect(() => envOf(stack)).toThrow(
      /set env var TABLE to different values: Stack\/One\/Resource vs Stack\/Two\/Resource/,
    );
  });

  it("throws for a construct without a lambda function", () => {
    const stack = addStack(new App(), "EmptyStack");

    expect(() => envOf(stack)).toThrow(/contains no Lambda function/);
  });

  it("throws for env-agnostic stacks when the env needs a lookup", () => {
    const app = new App();
    const stack = new Stack(app, "AgnosticStack");
    const queue = new sqs.Queue(stack, "Jobs");
    const handler = addFunction({ stack, id: "Handler", environment: { Q: queue.queueUrl } });

    expect(() => envOf(handler)).toThrow(/unresolved region/);
  });

  it("allows lambdas in stacks without a region when they only set literals", () => {
    const app = new App();
    const stack = new Stack(app, "AgnosticStack");
    const handler = addFunction({ stack, id: "Handler", environment: { A: "b" } });

    expect(envOf(handler)).toEqual({ A: "b" });
  });
});

describe("persistDevEnv", () => {
  it("round-trips a persisted config through the CLI json loader", async () => {
    const { handler } = buildApp();
    const config = generateDevEnv({
      projectName: "example-app",
      env: { ...envOf(handler), API_KEY: secret({ secretId: "example/secrets" }) },
    });
    const dir = makeTempDir();
    persistDevEnv(config, { path: join(dir, "aws-env.config.json") });

    const loaded = await loadConfig({ cwd: dir, stage: "staging" });

    expect(loaded.projectKey).toBe(config.projectKey);
    expect(loaded.config).toEqual(only(config).config);
    expect(loaded.resources).toEqual(only(config).resources);
    expect(loaded.secrets).toEqual(only(config).secrets);
    expect(loaded.target).toBeUndefined();
  });

  it("devEnv writes nested paths and returns the config", () => {
    const { handler } = buildApp();
    const path = join(makeTempDir(), "nested", "aws-env.config.json");

    const config = devEnv({ projectName: "example-app", env: envOf(handler), path });

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(config);
  });

  it("writes to aws-env.config.<stage>.json when a stage is given", () => {
    const { handler } = buildApp();
    const dir = makeTempDir();
    const previous = process.cwd();
    process.chdir(dir);
    try {
      devEnv({ projectName: "example-app", stage: "stg", env: envOf(handler) });
    } finally {
      process.chdir(previous);
    }

    expect(existsSync(join(dir, "aws-env.config.stg.json"))).toBe(true);
    expect(existsSync(join(dir, "aws-env.config.json"))).toBe(false);
  });

  it("rejects a stage that is unsafe in file names", () => {
    const { handler } = buildApp();

    expect(() =>
      devEnv({ projectName: "example-app", stage: "../prod", env: envOf(handler) }),
    ).toThrow(/stage must start with a letter or digit/);
  });

  it("writes to aws-env.config.json in the cwd by default", () => {
    const { handler } = buildApp();
    const dir = makeTempDir();
    const previous = process.cwd();
    process.chdir(dir);
    try {
      devEnv({ projectName: "example-app", env: envOf(handler) });
    } finally {
      process.chdir(previous);
    }

    expect(JSON.parse(readFileSync(join(dir, "aws-env.config.json"), "utf8")).projectKey).toBe(
      "example-app",
    );
  });
});
