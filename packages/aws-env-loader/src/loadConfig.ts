import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as v from "valibot";

import type { ResolveEnvOptions, ResourceTransform } from "../index.ts";
import type { EmittedTarget } from "./emit.ts";
import {
  defaultTarget,
  emittedConfigSchema,
  emittedResolverConfigSchema,
  emittedResourceReferenceSchema,
  emittedSecretMappingSchema,
  flatEmittedConfigSchema,
  transformTagSchema,
} from "./emit.ts";

export type LoadedConfig = Omit<ResolveEnvOptions, "stage" | "refresh" | "trusted">;

/** A stage is used in file names and keychain services, so keep it to a safe character set. */
export const stageSchema = safeNameSchema("stage");

/** A target is used in cache keys and CLI flags, so it follows the same character set as a stage. */
export const targetSchema = safeNameSchema("target");

const configExtensions = ["ts", "js", "mjs", "json"] as const;

/** Config file names to look for, most specific first: `aws-env.config.<stage>.<ext>`, then `aws-env.config.<ext>`. */
export function configFileNames(stage?: string): ReadonlyArray<string> {
  const generic = configExtensions.map((extension) => `aws-env.config.${extension}`);
  if (stage == null) {
    return generic;
  }
  return [
    ...configExtensions.map((extension) => `aws-env.config.${stage}.${extension}`),
    ...generic,
  ];
}

export function findConfigPath(props: {
  readonly cwd: string;
  readonly stage?: string;
  readonly explicitPath?: string;
}): string {
  if (props.explicitPath != null) {
    const absolutePath = resolve(props.cwd, props.explicitPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Config file not found: ${absolutePath}`);
    }
    return absolutePath;
  }

  const names = configFileNames(props.stage);
  const found = names
    .map((name) => resolve(props.cwd, name))
    .find((candidate) => existsSync(candidate));
  if (found == null) {
    throw new Error(
      `No config file found in ${props.cwd}. Expected one of: ${names.join(", ")} (or pass --config <path>)`,
    );
  }
  return found;
}

export async function loadConfig(props: {
  readonly cwd: string;
  readonly stage?: string;
  readonly target?: string;
  readonly configPath?: string;
}): Promise<LoadedConfig> {
  const absolutePath = findConfigPath({
    cwd: props.cwd,
    stage: props.stage,
    explicitPath: props.configPath,
  });
  if (extname(absolutePath) === ".json") {
    return loadJsonConfig({ absolutePath, target: props.target });
  }
  return loadModuleConfig({ absolutePath, stage: props.stage, target: props.target });
}

function isResourceTransform(input: unknown): input is ResourceTransform {
  return typeof input === "function" || v.is(transformTagSchema, input);
}

const resourceReferenceSchema = v.object({
  ...emittedResourceReferenceSchema.entries,
  transform: v.optional(v.custom<ResourceTransform>(isResourceTransform)),
});

const resourceMappingSchema = v.object({
  envVar: v.string(),
  ...resourceReferenceSchema.entries,
});

const templateMappingSchema = v.object({
  envVar: v.string(),
  parts: v.array(v.union([v.string(), resourceReferenceSchema])),
});

const moduleConfigSchema = v.object({
  projectKey: v.string(),
  config: emittedResolverConfigSchema,
  resources: v.array(v.union([resourceMappingSchema, templateMappingSchema])),
  secrets: v.optional(v.array(emittedSecretMappingSchema)),
  cacheTtlMs: v.optional(v.number()),
});

async function loadJsonConfig(props: {
  readonly absolutePath: string;
  readonly target?: string;
}): Promise<LoadedConfig> {
  const raw: unknown = JSON.parse(await readFile(props.absolutePath, "utf8"));
  const { projectKey, targets } = parseJsonConfig({ raw, absolutePath: props.absolutePath });
  const selected = selectTarget({
    targets,
    target: props.target,
    absolutePath: props.absolutePath,
  });
  const { config, resources, secrets } = selected.body;
  return { projectKey, config, resources, secrets, target: nonDefaultTarget(selected.name) };
}

function parseJsonConfig(props: { readonly raw: unknown; readonly absolutePath: string }): {
  readonly projectKey: string;
  readonly targets: Record<string, EmittedTarget>;
} {
  const { raw, absolutePath } = props;
  const hasTargets = typeof raw === "object" && raw != null && "targets" in raw;
  if (hasTargets) {
    const result = v.safeParse(emittedConfigSchema, raw);
    if (!result.success) {
      throw new Error(`Invalid config ${absolutePath}: ${v.summarize(result.issues)}`);
    }
    return result.output;
  }
  const flat = v.safeParse(flatEmittedConfigSchema, raw);
  if (!flat.success) {
    throw new Error(`Invalid config ${absolutePath}: ${v.summarize(flat.issues)}`);
  }
  const { projectKey, config, resources, secrets } = flat.output;
  return { projectKey, targets: { [defaultTarget]: { config, resources, secrets } } };
}

function selectTarget(props: {
  readonly targets: Record<string, EmittedTarget>;
  readonly target?: string;
  readonly absolutePath: string;
}): { readonly name: string; readonly body: EmittedTarget } {
  const { targets, target, absolutePath } = props;
  const names = Object.keys(targets);
  const available = names.join(", ");
  if (target != null) {
    const body = targets[target];
    if (body == null) {
      throw new Error(`Target "${target}" not found in ${absolutePath}. Available: ${available}`);
    }
    return { name: target, body };
  }
  const [only] = names;
  const onlyBody = only == null ? undefined : targets[only];
  if (only == null || onlyBody == null) {
    throw new Error(`Config ${absolutePath} has no targets`);
  }
  if (names.length > 1) {
    throw new Error(
      `Config ${absolutePath} has several targets (${available}). Pass --target <name>.`,
    );
  }
  return { name: only, body: onlyBody };
}

function nonDefaultTarget(name: string | undefined): string | undefined {
  return name === defaultTarget ? undefined : name;
}

async function loadModuleConfig(props: {
  readonly absolutePath: string;
  readonly stage?: string;
  readonly target?: string;
}): Promise<LoadedConfig> {
  const loadedModule: { default?: unknown } = await import(pathToFileURL(props.absolutePath).href);
  const exported = loadedModule.default;
  if (exported == null) {
    throw new Error(
      `Config ${props.absolutePath} has no default export. Export an options object or a (stage) => options factory.`,
    );
  }
  const options =
    typeof exported === "function" ? await exported(props.stage, props.target) : exported;
  const result = v.safeParse(moduleConfigSchema, options);
  if (!result.success) {
    throw new Error(`Invalid config ${props.absolutePath}: ${v.summarize(result.issues)}`);
  }
  return { ...result.output, target: nonDefaultTarget(props.target) };
}

function safeNameSchema(label: string) {
  return v.pipe(
    v.string(),
    v.regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      `${label} must start with a letter or digit and contain only letters, digits, '.', '_' or '-'`,
    ),
  );
}
