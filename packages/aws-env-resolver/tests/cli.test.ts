import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolveEnvOptions } from "../index.ts";
import { runCli } from "../src/cli.ts";
import type { CliDeps } from "../src/cli.ts";
import { loadConfig } from "../src/loadConfig.ts";
import type { LoadedConfig } from "../src/loadConfig.ts";

const baseConfig: LoadedConfig = {
  projectKey: "example-app",
  config: {
    profile: "config-profile",
    region: "eu-central-1",
    stackName: "example-stack",
    secretId: "example/secrets",
    staticEnv: { BASE_URI: "https://example.test" },
  },
  resources: [{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }],
  secrets: [{ envVar: "API_KEY" }, { envVar: "HMAC_SECRET" }],
};

type PurgeProps = Parameters<CliDeps["purgeCache"]>[0];
type SpawnProps = Parameters<CliDeps["spawnCommand"]>[0];

interface Harness {
  readonly deps: Partial<CliDeps>;
  readonly resolveCalls: Array<ResolveEnvOptions>;
  readonly purgeCalls: Array<PurgeProps>;
  readonly spawnCalls: Array<SpawnProps>;
  readonly stdout: Array<string>;
  readonly stderr: Array<string>;
  readonly processEnv: Record<string, string | undefined>;
}

function createHarness(overrides: Partial<CliDeps> = {}): Harness {
  const resolveCalls: Array<ResolveEnvOptions> = [];
  const purgeCalls: Array<PurgeProps> = [];
  const spawnCalls: Array<SpawnProps> = [];
  const stdout: Array<string> = [];
  const stderr: Array<string> = [];
  const processEnv: Record<string, string | undefined> = {};
  const deps: Partial<CliDeps> = {
    resolveEnv: async (options) => {
      resolveCalls.push(options);
      return { DATA_TABLE_NAME: "table-1" };
    },
    purgeCache: async (props) => {
      purgeCalls.push(props);
    },
    spawnCommand: async (props) => {
      spawnCalls.push(props);
      return 7;
    },
    loadConfig: async () => baseConfig,
    processEnv,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    ...overrides,
  };
  return { deps, resolveCalls, purgeCalls, spawnCalls, stdout, stderr, processEnv };
}

describe("runCli", () => {
  it("runs without --stage and passes no stage on", async () => {
    const harness = createHarness();

    const code = await runCli({ argv: ["--", "bun", "dev.tsx"], cwd: "/tmp", deps: harness.deps });

    expect(code).toBe(7);
    expect(harness.resolveCalls[0]?.stage).toBeUndefined();
  });

  it("passes --target to the config loader, resolveEnv and purge", async () => {
    const loadCalls: Array<{ readonly target?: string }> = [];
    const harness = createHarness({
      loadConfig: async (props) => {
        loadCalls.push(props);
        return { ...baseConfig, target: props.target };
      },
    });

    await runCli({
      argv: ["--stage", "dev", "--target", "web", "--purge", "--", "echo"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(loadCalls[0]?.target).toBe("web");
    expect(harness.resolveCalls[0]?.target).toBe("web");
    expect(harness.purgeCalls[0]?.target).toBe("web");
    expect(harness.stdout.join("")).toContain("(dev, web)");
  });

  it("fails with exit code 2 on a target that is unsafe as a cache key", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--target", "../web", "--", "echo"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(2);
    expect(harness.stderr.join("")).toContain("target must start with a letter or digit");
  });

  it("treats a non-flag first argument as the command, as Bun drops a leading --", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["bun", "--hot", "dev.tsx", "--", "--trusted"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(7);
    expect(harness.spawnCalls[0]?.command).toEqual(["bun", "--hot", "dev.tsx", "--", "--trusted"]);
    expect(harness.resolveCalls[0]?.trusted).toBe(false);
  });

  it("fails with exit code 2 on a stage that is unsafe in file names", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--stage", "../prod", "--", "echo"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(2);
    expect(harness.stderr.join("")).toContain("stage must start with a letter or digit");
    expect(harness.resolveCalls).toHaveLength(0);
  });

  it("fails with exit code 2 when no command is given and --purge is absent", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--stage", "staging"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(2);
    expect(harness.stderr.join("")).toContain("command");
    expect(harness.spawnCalls).toHaveLength(0);
  });

  it("fails with exit code 2 on unknown flags", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--bogus", "--", "echo"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(2);
    expect(harness.spawnCalls).toHaveLength(0);
  });

  it("passes the tail after -- to spawnCommand untouched", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--", "bun", "--hot", "dev.tsx", "--", "--trusted"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(7);
    expect(harness.spawnCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]?.command).toEqual(["bun", "--hot", "dev.tsx", "--", "--trusted"]);
    expect(harness.spawnCalls[0]?.env).toEqual({ DATA_TABLE_NAME: "table-1" });
    expect(harness.processEnv.DATA_TABLE_NAME).toBe("table-1");
    expect(harness.resolveCalls[0]?.trusted).toBe(false);
  });

  it("flows --trusted, --refresh and --profile into resolveEnv options", async () => {
    const harness = createHarness();

    await runCli({
      argv: [
        "--stage",
        "prod-readonly",
        "--trusted",
        "--refresh",
        "--profile",
        "cli-profile",
        "--",
        "echo",
      ],
      cwd: "/tmp",
      deps: harness.deps,
    });

    const options = harness.resolveCalls[0];
    expect(options?.stage).toBe("prod-readonly");
    expect(options?.trusted).toBe(true);
    expect(options?.refresh).toBe(true);
    expect(options?.config.profile).toBe("cli-profile");
    expect(options?.projectKey).toBe("example-app");
  });

  it("keeps the config profile when --profile is absent", async () => {
    const harness = createHarness();

    await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(harness.resolveCalls[0]?.config.profile).toBe("config-profile");
  });

  it("purges without spawning when --purge has no command", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--purge"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(0);
    expect(harness.purgeCalls).toEqual([
      {
        projectKey: "example-app",
        stage: "staging",
        config: { region: "eu-central-1", stackName: "example-stack", secretId: "example/secrets" },
        secretKeys: ["API_KEY", "HMAC_SECRET"],
      },
    ]);
    expect(harness.spawnCalls).toHaveLength(0);
    expect(harness.resolveCalls).toHaveLength(0);
    expect(harness.stdout.join("")).toContain("Purged");
  });

  it("purges and then spawns when --purge has a command", async () => {
    const harness = createHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--purge", "--", "echo", "hi"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(7);
    expect(harness.purgeCalls).toHaveLength(1);
    expect(harness.resolveCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]?.command).toEqual(["echo", "hi"]);
  });

  it("returns 1 and prints the message when resolveEnv throws", async () => {
    const harness = createHarness({
      resolveEnv: async () => {
        throw new Error("no resource matches DATA_TABLE_NAME");
      },
    });

    const code = await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: "/tmp",
      deps: harness.deps,
    });

    expect(code).toBe(1);
    expect(harness.stderr.join("")).toContain("no resource matches DATA_TABLE_NAME");
    expect(harness.spawnCalls).toHaveLength(0);
  });

  it("prints usage and returns 0 for --help", async () => {
    const harness = createHarness();

    const code = await runCli({ argv: ["--help"], cwd: "/tmp", deps: harness.deps });

    expect(code).toBe(0);
    expect(harness.stdout.join("")).toContain("Usage:");
    expect(harness.stdout.join("")).toContain("--stage");
  });
});

describe("runCli config loading", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "aws-env-resolver-cli-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function realConfigHarness(): Harness {
    return createHarness({ loadConfig });
  }

  it("invokes a default-exported factory with the --stage value", async () => {
    const recordPath = join(directory, "recorded.txt");
    await writeFile(
      join(directory, "aws-env.config.mjs"),
      `import { writeFileSync } from "node:fs";
export default (stage) => {
  writeFileSync(${JSON.stringify(recordPath)}, stage);
  return {
    projectKey: "example-app",
    config: { region: "eu-central-1", stackName: "stack-" + stage, staticEnv: {} },
    resources: [{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data", transform: (name) => name + "!" }],
  };
};
`,
    );
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "acme-dev", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(7);
    expect(await Bun.file(recordPath).text()).toBe("acme-dev");
    expect(harness.resolveCalls[0]?.config.stackName).toBe("stack-acme-dev");
    expect(harness.resolveCalls[0]?.resources[0]).toMatchObject({
      transform: expect.any(Function),
    });
  });

  it("accepts an async factory", async () => {
    await writeFile(
      join(directory, "aws-env.config.mjs"),
      `export default async (stage) => ({
  projectKey: "example-app",
  config: { region: "eu-central-1", stackName: stage, staticEnv: {} },
  resources: [],
});
`,
    );
    const harness = realConfigHarness();

    await runCli({
      argv: ["--stage", "async-ns", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(harness.resolveCalls[0]?.config.stackName).toBe("async-ns");
  });

  it("accepts a default-exported options object via --config", async () => {
    await writeFile(
      join(directory, "custom.config.mjs"),
      `export default {
  projectKey: "object-app",
  config: { region: "eu-west-1", stackName: "object-stack", staticEnv: { A: "1" } },
  resources: [],
};
`,
    );
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--config", "custom.config.mjs", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(7);
    expect(harness.resolveCalls[0]?.projectKey).toBe("object-app");
    expect(harness.resolveCalls[0]?.config.staticEnv).toEqual({ A: "1" });
  });

  it("returns 1 when the module has no default export", async () => {
    await writeFile(join(directory, "aws-env.config.mjs"), "export const nothing = 1;\n");
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(1);
    expect(harness.stderr.join("")).toContain("default export");
  });

  it("returns 1 when the module config has an invalid shape", async () => {
    await writeFile(join(directory, "aws-env.config.mjs"), "export default { projectKey: 1 };\n");
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(1);
    expect(harness.stderr.join("")).toContain("Invalid config");
  });

  it("loads and validates an emitted .json config with tagged transforms", async () => {
    await writeFile(
      join(directory, "aws-env.config.json"),
      JSON.stringify({
        projectKey: "json-app",
        config: { region: "eu-central-1", stackName: "json-stack", staticEnv: { X: "y" } },
        resources: [
          { envVar: "HANDLER_ARN", logicalIdPrefix: "Handler", transform: { kind: "lambdaArn" } },
        ],
        secrets: [{ envVar: "API_KEY" }],
      }),
    );
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(7);
    const options = harness.resolveCalls[0];
    expect(options?.projectKey).toBe("json-app");
    expect(options?.resources[0]).toMatchObject({ transform: { kind: "lambdaArn" } });
    expect(options?.secrets).toEqual([{ envVar: "API_KEY" }]);
  });

  it("returns 1 with a clear message for an invalid .json config", async () => {
    await writeFile(
      join(directory, "aws-env.config.json"),
      JSON.stringify({ projectKey: "json-app", resources: [] }),
    );
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(1);
    expect(harness.stderr.join("")).toContain("Invalid config");
    expect(harness.spawnCalls).toHaveLength(0);
  });

  it("returns 1 when no config file exists", async () => {
    const harness = realConfigHarness();

    const code = await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(code).toBe(1);
    expect(harness.stderr.join("")).toContain("No config file found");
  });

  it("prefers aws-env.config.<stage>.json over the generic config", async () => {
    const write = (name: string, projectKey: string) =>
      writeFile(
        join(directory, name),
        JSON.stringify({
          projectKey,
          config: { region: "eu-central-1", stackName: projectKey, staticEnv: {} },
          resources: [],
        }),
      );
    await write("aws-env.config.json", "generic");
    await write("aws-env.config.stg.json", "staged");
    const harness = realConfigHarness();

    await runCli({ argv: ["--stage", "stg", "--", "echo"], cwd: directory, deps: harness.deps });
    await runCli({ argv: ["--stage", "prod", "--", "echo"], cwd: directory, deps: harness.deps });
    await runCli({ argv: ["--", "echo"], cwd: directory, deps: harness.deps });

    expect(harness.resolveCalls.map((options) => options.projectKey)).toEqual([
      "staged",
      "generic",
      "generic",
    ]);
  });

  it("prefers .ts over .json in default lookup order", async () => {
    await writeFile(
      join(directory, "aws-env.config.ts"),
      `export default { projectKey: "ts-app", config: { region: "r", stackName: "s", staticEnv: {} }, resources: [] };\n`,
    );
    await writeFile(
      join(directory, "aws-env.config.json"),
      JSON.stringify({
        projectKey: "json-app",
        config: { region: "r", stackName: "s", staticEnv: {} },
        resources: [],
      }),
    );
    const harness = realConfigHarness();

    await runCli({
      argv: ["--stage", "staging", "--", "echo"],
      cwd: directory,
      deps: harness.deps,
    });

    expect(harness.resolveCalls[0]?.projectKey).toBe("ts-app");
  });
});
