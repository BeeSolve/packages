import { defaultStage, purgeCache as purgeCacheFile } from "./src/cache.ts";
import { defaultResolveEnvDeps, resolveEnvWithDeps } from "./src/resolveEnv.ts";
import { createSecretStore } from "./src/secretStore.ts";

export type { EmittedConfig, EmittedTarget } from "./src/emit.ts";
export { defaultTarget, emittedConfigSchema, emittedTargetSchema } from "./src/emit.ts";

/**
 * Resolve the full env as a flat record. Does not mutate `process.env`.
 *
 * Precedence when the same env var appears in several sources (later wins):
 * `config.staticEnv` < CloudFormation resources < secrets.
 *
 * Steady state (fresh temp-dir cache and all secrets in the keychain) makes zero AWS calls.
 */
export function resolveEnv(options: ResolveEnvOptions): Promise<Record<string, string>> {
  return resolveEnvWithDeps(options, defaultResolveEnvDeps);
}

/** Delete the temp-dir cache file and the keychain item for exactly this identity. */
export async function purgeCache(props: {
  readonly projectKey: string;
  /** Stage whose cache to purge; defaults to the same label `resolveEnv` uses without one. */
  readonly stage?: string;
  /** Target whose resource cache to purge; omit for the `default` target. */
  readonly target?: string;
  readonly config: Pick<ResolverConfig, "region" | "stackName" | "secretId">;
}): Promise<void> {
  const { projectKey, config } = props;
  const stage = props.stage ?? defaultStage;
  purgeCacheFile({ identity: { projectKey, stage, config, target: props.target } });
  const store = createSecretStore({
    projectKey,
    stage,
    config,
  });
  await store.purge();
}

/** Fully-resolved configuration for one resolution run. Supplied by the consuming project. */
export interface ResolverConfig {
  /** AWS profile for fromIni(); omit to use the default provider chain. */
  readonly profile?: string;
  /** AWS region all clients are built against. */
  readonly region: string;
  /** CloudFormation stack, or stacks, to read resources from. All stacks live in `region`. */
  readonly stackName: string | ReadonlyArray<string>;
  /** Secrets Manager id to read secrets from; omit if the project has no secrets. */
  readonly secretId?: string;
  /** Optional account id for ARN construction; resolved via STS on demand if omitted. */
  readonly accountId?: string;
  /** Env vars that need no AWS lookup (fixed URLs, constant index names, region, ...). */
  readonly staticEnv: Record<string, string>;
}

/** Declarative transform recorded in a JSON-emitted config, interpreted by the resolver. */
export interface TransformTag {
  readonly kind: "lambdaArn";
}

/** Context passed to a function transform when turning a physical id into a final value. */
export interface TransformContext {
  readonly region: string;
  readonly accountId: string;
}

/**
 * Transform for a resolved resource value: either a function (hand-written `.ts` config) or a
 * declarative tag (CDK-emitted `.json` config).
 */
export type ResourceTransform =
  | ((physicalId: string, ctx: TransformContext) => string)
  | TransformTag;

/** Points at one CloudFormation stack resource. */
export interface ResourceReference {
  /** Logical-id prefix to match the stack resource by, e.g. "Data", "ExportsBucket". */
  readonly logicalIdPrefix: string;
  /** Optional resource-type filter, e.g. "AWS::DynamoDB::Table". */
  readonly resourceType?: string;
  /** Stack to look the resource up in; omit to search every configured stack. */
  readonly stackName?: string;
  /** Transform the physical id into the final value (e.g. a Lambda name -> an ARN). */
  readonly transform?: ResourceTransform;
}

/** One target env var resolved from a CloudFormation stack resource. */
export interface ResourceMapping extends ResourceReference {
  /** Target env var, e.g. "DATA_TABLE_NAME". */
  readonly envVar: string;
}

/**
 * One target env var built by concatenating literal text and resolved resources, e.g. a JSON
 * string embedding a queue url.
 */
export interface TemplateMapping {
  /** Target env var, e.g. "ADDITIONAL_QUEUE_URLS". */
  readonly envVar: string;
  readonly parts: ReadonlyArray<string | ResourceReference>;
}

/** Secrets Manager JSON key -> target env var. */
export interface SecretMapping {
  /** Target env var, e.g. "API_KEY". */
  readonly envVar: string;
  /** Key inside the secret JSON; defaults to envVar. */
  readonly jsonKey?: string;
}

/** Input to `resolveEnv`. */
export interface ResolveEnvOptions {
  readonly config: ResolverConfig;
  readonly resources: ReadonlyArray<ResourceMapping | TemplateMapping>;
  readonly secrets?: ReadonlyArray<SecretMapping>;
  /** Human-readable cache/keychain prefix, e.g. the project name. From the committed config. */
  readonly projectKey: string;
  /**
   * Stage label, e.g. "stg" or "dev-ivan". Selects the per-stage config file, is passed to a
   * config factory, and, with a fingerprint of { region, stackName, secretId }, keys the cache
   * file and keychain service. Omit for single-stage projects; caches then use "default".
   */
  readonly stage?: string;
  /**
   * Target this run resolves, e.g. "web". Keys the resource cache so targets that share a stack
   * never read each other's values. Omit (or leave unset for the `default` target) otherwise.
   */
  readonly target?: string;
  /** Bypass caches, re-fetch from AWS, rewrite caches. */
  readonly refresh?: boolean;
  /** Non-secret temp-dir cache TTL in ms; default 24h. */
  readonly cacheTtlMs?: number;
  /** Keychain silent mode; independent opt-in, no stage coupling. */
  readonly trusted?: boolean;
}
