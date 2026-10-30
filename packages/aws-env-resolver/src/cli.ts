import { parseArgs } from "node:util";

import * as v from "valibot";

import { purgeCache, resolveEnv } from "../index.ts";
import type { ResolveEnvOptions } from "../index.ts";
import { loadConfig, stageSchema, targetSchema } from "./loadConfig.ts";
import type { LoadedConfig } from "./loadConfig.ts";
import { spawnCommand } from "./spawn.ts";

export interface CliDeps {
  readonly resolveEnv: typeof resolveEnv;
  readonly purgeCache: typeof purgeCache;
  readonly spawnCommand: typeof spawnCommand;
  readonly loadConfig: typeof loadConfig;
  readonly processEnv: Record<string, string | undefined>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export const usage = `Usage:
  aws-env-resolver [--stage <stage>] [options] -- <command...>

Resolves env from CloudFormation + Secrets Manager, then runs <command> with it.

Options:
  --stage <stage>    Stage to resolve. Picks aws-env.config.<stage>.* first, is passed to a
                     config factory, and keys the caches. Optional for single-stage projects.
  --target <name>    Target to resolve when the config defines several (e.g. web, worker).
                     Optional when the config has exactly one target.
  --config <path>    Config module or JSON (default: aws-env.config[.<stage>].{ts,js,mjs,json}).
  --profile <name>   AWS profile; overrides the config.
  --refresh          Bypass caches and re-fetch from AWS.
  --purge            Delete cached values for this stage (runs <command> only if given).
  --trusted          Store keychain items so reads are silent (no prompt).
  --help             Show this help.
`;

/** Run the CLI and return the process exit code. Never calls `process.exit`. */
export async function runCli(props: {
  readonly argv: ReadonlyArray<string>;
  readonly cwd: string;
  readonly deps?: Partial<CliDeps>;
}): Promise<number> {
  const deps: CliDeps = { ...defaultCliDeps, ...props.deps };
  const parsed = parseCliArgs(props.argv);

  if (parsed.kind === "help") {
    deps.stdout(usage);
    return 0;
  }
  if (parsed.kind === "invalid") {
    deps.stderr(`error: ${parsed.message}\n\n${usage}`);
    return 2;
  }
  return exitCodeOf({ work: () => execute({ parsed, cwd: props.cwd, deps }), deps });
}

const defaultCliDeps: CliDeps = {
  resolveEnv,
  purgeCache,
  spawnCommand,
  loadConfig,
  processEnv: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

const flagsSchema = v.object({
  stage: v.optional(stageSchema),
  target: v.optional(targetSchema),
  config: v.optional(v.string()),
  profile: v.optional(v.string()),
  refresh: v.optional(v.boolean()),
  purge: v.optional(v.boolean()),
  trusted: v.optional(v.boolean()),
  help: v.optional(v.boolean()),
});

interface RunRequest {
  readonly kind: "run";
  readonly stage?: string;
  readonly target?: string;
  readonly configPath?: string;
  readonly profile?: string;
  readonly refresh: boolean;
  readonly purge: boolean;
  readonly trusted: boolean;
  readonly command: ReadonlyArray<string>;
}

type ParsedCli =
  | RunRequest
  | { readonly kind: "help" }
  | { readonly kind: "invalid"; readonly message: string };

function parseCliArgs(argv: ReadonlyArray<string>): ParsedCli {
  const [first] = argv;
  // Bun drops a leading "--" from process.argv, so `aws-env-resolver -- cmd` arrives as `cmd`.
  // Flags always start with "-", so a non-flag first argument starts the command.
  if (first != null && !first.startsWith("-")) {
    return parseRequest({ flagArgs: [], command: argv });
  }
  const separatorIndex = argv.indexOf("--");
  const flagArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const command = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  return parseRequest({ flagArgs, command });
}

function parseRequest(props: {
  readonly flagArgs: ReadonlyArray<string>;
  readonly command: ReadonlyArray<string>;
}): ParsedCli {
  const { flagArgs, command } = props;
  const raw = readFlags(flagArgs);
  if (!raw.ok) {
    return { kind: "invalid", message: raw.message };
  }
  const result = v.safeParse(flagsSchema, raw.values);
  if (!result.success) {
    return { kind: "invalid", message: v.summarize(result.issues) };
  }

  const flags = result.output;
  if (flags.help === true) {
    return { kind: "help" };
  }
  const purge = flags.purge === true;
  if (!purge && command.length === 0) {
    return { kind: "invalid", message: "a command is required after -- (or pass --purge)" };
  }
  return {
    kind: "run",
    stage: flags.stage,
    target: flags.target,
    configPath: flags.config,
    profile: flags.profile,
    refresh: flags.refresh === true,
    purge,
    trusted: flags.trusted === true,
    command,
  };
}

function readFlags(
  flagArgs: ReadonlyArray<string>,
):
  | { readonly ok: true; readonly values: unknown }
  | { readonly ok: false; readonly message: string } {
  try {
    const { values } = parseArgs({
      args: [...flagArgs],
      strict: true,
      allowPositionals: false,
      options: {
        stage: { type: "string" },
        target: { type: "string" },
        config: { type: "string" },
        profile: { type: "string" },
        refresh: { type: "boolean" },
        purge: { type: "boolean" },
        trusted: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    return { ok: true, values };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

async function execute(props: {
  readonly parsed: RunRequest;
  readonly cwd: string;
  readonly deps: CliDeps;
}): Promise<number> {
  const { parsed, cwd, deps } = props;
  const loaded = await deps.loadConfig({
    cwd,
    stage: parsed.stage,
    target: parsed.target,
    configPath: parsed.configPath,
  });
  const options = buildOptions({ loaded, parsed });

  if (parsed.purge) {
    await deps.purgeCache({
      projectKey: options.projectKey,
      stage: options.stage,
      target: options.target,
      config: {
        region: options.config.region,
        stackName: options.config.stackName,
        secretId: options.config.secretId,
      },
      secretKeys: (options.secrets ?? []).map((secret) => secret.envVar),
    });
    deps.stdout(`Purged cached values for ${options.projectKey}${describeScope(options)}.\n`);
    if (parsed.command.length === 0) {
      return 0;
    }
  }

  const env = await deps.resolveEnv(options);
  Object.assign(deps.processEnv, env);
  return deps.spawnCommand({ command: parsed.command, env });
}

function describeScope(options: ResolveEnvOptions): string {
  const labels = [options.stage, options.target].filter((label) => label != null);
  return labels.length === 0 ? "" : ` (${labels.join(", ")})`;
}

function buildOptions(props: {
  readonly loaded: LoadedConfig;
  readonly parsed: RunRequest;
}): ResolveEnvOptions {
  const { loaded, parsed } = props;
  return {
    ...loaded,
    stage: parsed.stage,
    refresh: parsed.refresh,
    trusted: parsed.trusted,
    config: { ...loaded.config, profile: parsed.profile ?? loaded.config.profile },
  };
}

async function exitCodeOf(props: {
  readonly work: () => Promise<number>;
  readonly deps: CliDeps;
}): Promise<number> {
  try {
    return await props.work();
  } catch (error) {
    props.deps.stderr(`error: ${errorMessage(error)}\n`);
    return 1;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
