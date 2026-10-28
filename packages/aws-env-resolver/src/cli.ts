import { parseArgs } from "node:util";

import * as v from "valibot";

import { purgeCache, resolveEnv } from "../index.ts";
import type { ResolveEnvOptions } from "../index.ts";
import { loadConfig } from "./loadConfig.ts";
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
  aws-env-resolver --namespace <ns> [options] -- <command...>

Resolves env from CloudFormation + Secrets Manager, then runs <command> with it.

Options:
  --namespace <ns>   Required. Opaque label passed to the config factory and used to key caches.
  --config <path>    Config module or JSON (default: aws-env.config.{ts,js,mjs,json} in cwd).
  --profile <name>   AWS profile; overrides the config.
  --refresh          Bypass caches and re-fetch from AWS.
  --purge            Delete cached values for this namespace (runs <command> only if given).
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
  namespace: v.optional(v.string()),
  config: v.optional(v.string()),
  profile: v.optional(v.string()),
  refresh: v.optional(v.boolean()),
  purge: v.optional(v.boolean()),
  trusted: v.optional(v.boolean()),
  help: v.optional(v.boolean()),
});

interface RunRequest {
  readonly kind: "run";
  readonly namespace: string;
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
  const separatorIndex = argv.indexOf("--");
  const flagArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const command = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);

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
  if (flags.namespace == null || flags.namespace === "") {
    return { kind: "invalid", message: "--namespace is required" };
  }
  const purge = flags.purge === true;
  if (!purge && command.length === 0) {
    return { kind: "invalid", message: "a command is required after -- (or pass --purge)" };
  }
  return {
    kind: "run",
    namespace: flags.namespace,
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
        namespace: { type: "string" },
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
    namespace: parsed.namespace,
    configPath: parsed.configPath,
  });
  const options = buildOptions({ loaded, parsed });

  if (parsed.purge) {
    await deps.purgeCache({
      projectKey: options.projectKey,
      namespace: options.namespace,
      config: {
        region: options.config.region,
        stackName: options.config.stackName,
        secretId: options.config.secretId,
      },
      secretKeys: (options.secrets ?? []).map((secret) => secret.envVar),
    });
    deps.stdout(`Purged cached values for ${options.projectKey} (${options.namespace}).\n`);
    if (parsed.command.length === 0) {
      return 0;
    }
  }

  const env = await deps.resolveEnv(options);
  Object.assign(deps.processEnv, env);
  return deps.spawnCommand({ command: parsed.command, env });
}

function buildOptions(props: {
  readonly loaded: LoadedConfig;
  readonly parsed: RunRequest;
}): ResolveEnvOptions {
  const { loaded, parsed } = props;
  return {
    ...loaded,
    namespace: parsed.namespace,
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
