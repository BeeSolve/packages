import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as v from "valibot";

import type { ResolveEnvOptions, ResourceTransform } from "../index.ts";
import {
  emittedConfigSchema,
  emittedResolverConfigSchema,
  emittedSecretMappingSchema,
  transformTagSchema,
} from "./emit.ts";

export type LoadedConfig = Omit<ResolveEnvOptions, "namespace" | "refresh" | "trusted">;

export const defaultConfigNames = [
  "aws-env.config.ts",
  "aws-env.config.js",
  "aws-env.config.mjs",
  "aws-env.config.json",
] as const;

export function findConfigPath(props: {
  readonly cwd: string;
  readonly explicitPath?: string;
}): string {
  if (props.explicitPath != null) {
    const absolutePath = resolve(props.cwd, props.explicitPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Config file not found: ${absolutePath}`);
    }
    return absolutePath;
  }

  const found = defaultConfigNames
    .map((name) => resolve(props.cwd, name))
    .find((candidate) => existsSync(candidate));
  if (found == null) {
    throw new Error(
      `No config file found in ${props.cwd}. Expected one of: ${defaultConfigNames.join(", ")} (or pass --config <path>)`,
    );
  }
  return found;
}

export async function loadConfig(props: {
  readonly cwd: string;
  readonly namespace: string;
  readonly configPath?: string;
}): Promise<LoadedConfig> {
  const absolutePath = findConfigPath({ cwd: props.cwd, explicitPath: props.configPath });
  if (extname(absolutePath) === ".json") {
    return loadJsonConfig(absolutePath);
  }
  return loadModuleConfig({ absolutePath, namespace: props.namespace });
}

function isResourceTransform(input: unknown): input is ResourceTransform {
  return typeof input === "function" || v.is(transformTagSchema, input);
}

const moduleConfigSchema = v.object({
  projectKey: v.string(),
  config: emittedResolverConfigSchema,
  resources: v.array(
    v.object({
      envVar: v.string(),
      logicalIdPrefix: v.string(),
      resourceType: v.optional(v.string()),
      transform: v.optional(v.custom<ResourceTransform>(isResourceTransform)),
    }),
  ),
  secrets: v.optional(v.array(emittedSecretMappingSchema)),
  cacheTtlMs: v.optional(v.number()),
});

async function loadJsonConfig(absolutePath: string): Promise<LoadedConfig> {
  const raw: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
  const result = v.safeParse(emittedConfigSchema, raw);
  if (!result.success) {
    throw new Error(`Invalid config ${absolutePath}: ${v.summarize(result.issues)}`);
  }
  const { projectKey, config, resources, secrets } = result.output;
  return { projectKey, config, resources, secrets };
}

async function loadModuleConfig(props: {
  readonly absolutePath: string;
  readonly namespace: string;
}): Promise<LoadedConfig> {
  const loadedModule: { default?: unknown } = await import(pathToFileURL(props.absolutePath).href);
  const exported = loadedModule.default;
  if (exported == null) {
    throw new Error(
      `Config ${props.absolutePath} has no default export. Export an options object or a (namespace) => options factory.`,
    );
  }
  const options = typeof exported === "function" ? await exported(props.namespace) : exported;
  const result = v.safeParse(moduleConfigSchema, options);
  if (!result.success) {
    throw new Error(`Invalid config ${props.absolutePath}: ${v.summarize(result.issues)}`);
  }
  return result.output;
}
