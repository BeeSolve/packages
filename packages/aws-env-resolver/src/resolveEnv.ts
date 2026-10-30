import type { ResolveEnvOptions } from "../index.ts";
import type { CacheIdentity } from "./cache.ts";
import { defaultStage, purgeCache, readCache, writeCache } from "./cache.ts";
import { resolveStackResources } from "./resolveConfig.ts";
import { resolveSecrets } from "./secrets.ts";
import type { SecretStore } from "./secretStore.ts";
import { createSecretStore } from "./secretStore.ts";

export interface ResolveEnvDeps {
  readonly readCache: typeof readCache;
  readonly writeCache: typeof writeCache;
  readonly purgeCache: typeof purgeCache;
  readonly createSecretStore: typeof createSecretStore;
  readonly resolveStackResources: typeof resolveStackResources;
  readonly resolveSecrets: typeof resolveSecrets;
  readonly platform: NodeJS.Platform;
}

export const defaultResolveEnvDeps: ResolveEnvDeps = {
  readCache,
  writeCache,
  purgeCache,
  createSecretStore,
  resolveStackResources,
  resolveSecrets,
  platform: process.platform,
};

export async function resolveEnvWithDeps(
  options: ResolveEnvOptions,
  deps: ResolveEnvDeps,
): Promise<Record<string, string>> {
  const { config, projectKey } = options;
  const stage = options.stage ?? defaultStage;
  const secrets = options.secrets ?? [];
  const identity: CacheIdentity = {
    projectKey,
    stage,
    config: { region: config.region, stackName: config.stackName, secretId: config.secretId },
    target: options.target,
  };

  const resourceValues = await loadResourceValues({ options, identity, deps });

  if (secrets.length === 0) {
    return { ...config.staticEnv, ...resourceValues };
  }

  const store = deps.createSecretStore({
    projectKey,
    stage,
    config: identity.config,
    platform: deps.platform,
  });
  const secretValues = await loadSecretValues({ options, store, deps });

  return { ...config.staticEnv, ...resourceValues, ...secretValues };
}

async function loadResourceValues(props: {
  readonly options: ResolveEnvOptions;
  readonly identity: CacheIdentity;
  readonly deps: ResolveEnvDeps;
}): Promise<Record<string, string>> {
  const { options, identity, deps } = props;

  if (options.refresh !== true) {
    const cached = deps.readCache({ identity, cacheTtlMs: options.cacheTtlMs });
    if (cached != null) {
      return cached.values;
    }
  }

  const values = await deps.resolveStackResources({
    config: options.config,
    resources: options.resources,
  });
  deps.writeCache({ identity, values });
  return values;
}

async function loadSecretValues(props: {
  readonly options: ResolveEnvOptions;
  readonly store: SecretStore;
  readonly deps: ResolveEnvDeps;
}): Promise<Record<string, string>> {
  const { options, store, deps } = props;
  const secrets = options.secrets ?? [];

  if (options.refresh !== true) {
    const stored = await store.get();
    const envVars = secrets.map((mapping) => mapping.envVar);
    if (stored != null && envVars.every((envVar) => envVar in stored)) {
      return Object.fromEntries(envVars.map((envVar) => [envVar, stored[envVar] ?? ""]));
    }
  }

  const fetched = await deps.resolveSecrets({ config: options.config, secrets });
  await store.set({ values: fetched, trusted: options.trusted ?? false });
  return fetched;
}
