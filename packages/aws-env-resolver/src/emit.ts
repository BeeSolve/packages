import * as v from "valibot";

export const transformTagSchema = v.object({
  kind: v.picklist(["lambdaArn"] as const),
});

export const emittedResourceReferenceSchema = v.object({
  logicalIdPrefix: v.string(),
  resourceType: v.optional(v.string()),
  transform: v.optional(transformTagSchema),
  stackName: v.optional(v.string()),
});

export const emittedResourceMappingSchema = v.object({
  envVar: v.string(),
  ...emittedResourceReferenceSchema.entries,
});

/** An env var built from literal text and resolved resources, e.g. a JSON string embedding a queue url. */
export const emittedTemplateMappingSchema = v.object({
  envVar: v.string(),
  parts: v.array(v.union([v.string(), emittedResourceReferenceSchema])),
});

export const emittedSecretMappingSchema = v.object({
  envVar: v.string(),
  jsonKey: v.optional(v.string()),
});

export const emittedResolverConfigSchema = v.object({
  profile: v.optional(v.string()),
  region: v.string(),
  stackName: v.union([v.string(), v.array(v.string())]),
  secretId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  staticEnv: v.record(v.string(), v.string()),
});

/** Valibot schema for the JSON config the CDK emitter produces and the CLI loads. */
export const emittedConfigSchema = v.object({
  projectKey: v.string(),
  config: emittedResolverConfigSchema,
  resources: v.array(v.union([emittedResourceMappingSchema, emittedTemplateMappingSchema])),
  secrets: v.optional(v.array(emittedSecretMappingSchema)),
});

/** JSON-serializable config shape produced by the CDK emitter and loaded from `.json`. */
export type EmittedConfig = v.InferOutput<typeof emittedConfigSchema>;

/** A resolved CloudFormation intrinsic function object, e.g. `{ Ref: "Data666C94C7" }`. */
export type Intrinsic = Record<string, unknown>;

/** One lambda environment variable, already extracted from the construct tree. */
export interface ExtractedEnvEntry {
  readonly envVar: string;
  readonly value: string | { readonly intrinsic: Intrinsic };
  /** Stack the lambda lives in; recorded on resource mappings when several stacks are emitted. */
  readonly stackName?: string;
}

/** A Secrets Manager secret and the env vars sourced from it. */
export interface SecretSource {
  readonly secretId: string;
  readonly envVars: ReadonlyArray<string>;
}

/** Input for {@link buildEmittedConfig}. */
export interface BuildEmittedConfigProps {
  readonly projectName: string;
  readonly stackName: string | ReadonlyArray<string>;
  readonly region: string;
  readonly profile?: string;
  readonly entries: ReadonlyArray<ExtractedEnvEntry>;
  readonly secrets?: ReadonlyArray<SecretSource>;
  readonly staticEnv?: Record<string, string>;
}

type EmittedResourceMapping = v.InferOutput<typeof emittedResourceMappingSchema>;

type EmittedResourceReference = v.InferOutput<typeof emittedResourceReferenceSchema>;

type EmittedTemplateMapping = v.InferOutput<typeof emittedTemplateMappingSchema>;

type ResolvedEntry =
  | { readonly kind: "static"; readonly value: string }
  | { readonly kind: "resource"; readonly mapping: EmittedResourceMapping }
  | { readonly kind: "template"; readonly mapping: EmittedTemplateMapping };

const cdkHashSuffix = /[0-9A-F]{8}$/;

/**
 * Remove the trailing 8-character uppercase hex hash CDK appends to logical ids.
 * Returns the id unchanged when nothing would remain.
 */
export function stripCdkHash(logicalId: string): string {
  const stripped = logicalId.replace(cdkHashSuffix, "");
  return stripped.length === 0 ? logicalId : stripped;
}

/** Normalize a single stack name or a list of stack names to a list. */
export function toStackNames(stackName: string | ReadonlyArray<string>): ReadonlyArray<string> {
  return typeof stackName === "string" ? [stackName] : stackName;
}

/** Build the declarative resolver config from already-extracted lambda environment data. */
export function buildEmittedConfig(props: BuildEmittedConfigProps): EmittedConfig {
  const stackNames = toStackNames(props.stackName);
  const [firstStackName] = stackNames;
  if (firstStackName == null) {
    throw new Error("At least one stack name is required");
  }
  const multiStack = stackNames.length > 1;
  const secrets = props.secrets ?? [];
  const secretIds = [...new Set(secrets.map((source) => source.secretId))];
  if (secretIds.length > 1) {
    throw new Error(
      `Only one secretId is supported per emitted config, received: ${secretIds.join(", ")}`,
    );
  }
  const secretEnvVars = [...new Set(secrets.flatMap((source) => source.envVars))];
  const explicitStaticEnv = props.staticEnv ?? {};

  const resolvedByEnvVar: Record<string, ResolvedEntry> = {};
  const errors: Array<Error> = [];
  for (const entry of props.entries) {
    if (secretEnvVars.includes(entry.envVar) || entry.envVar in explicitStaticEnv) {
      continue;
    }
    const resolved = tryResolveEntry({ entry, multiStack, errors });
    if (resolved == null) {
      continue;
    }
    const existing = resolvedByEnvVar[entry.envVar];
    if (existing == null) {
      resolvedByEnvVar[entry.envVar] = resolved;
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(resolved)) {
      throw new Error(
        `Conflicting values for env var ${entry.envVar}: ${describeEntry(existing)} vs ${describeEntry(resolved)}`,
      );
    }
  }

  throwCollected(errors);

  const walkedStaticEnv: Record<string, string> = {};
  const resources: Array<EmittedResourceMapping | EmittedTemplateMapping> = [];
  for (const [envVar, resolved] of Object.entries(resolvedByEnvVar)) {
    if (resolved.kind === "static") {
      walkedStaticEnv[envVar] = resolved.value;
      continue;
    }
    resources.push(resolved.mapping);
  }

  return {
    projectKey: props.projectName,
    config: {
      ...(props.profile == null ? {} : { profile: props.profile }),
      region: props.region,
      stackName: multiStack ? [...stackNames] : firstStackName,
      ...(secretIds[0] == null ? {} : { secretId: secretIds[0] }),
      staticEnv: { ...walkedStaticEnv, ...explicitStaticEnv },
    },
    resources,
    ...(secretEnvVars.length === 0 ? {} : { secrets: secretEnvVars.map((envVar) => ({ envVar })) }),
  };
}

/** Resolve an entry; on failure record the error and return `undefined` so every problem is reported at once. */
function tryResolveEntry(props: {
  readonly entry: ExtractedEnvEntry;
  readonly multiStack: boolean;
  readonly errors: Array<Error>;
}): ResolvedEntry | undefined {
  try {
    return resolveEntry(props);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    props.errors.push(error);
    return undefined;
  }
}

function throwCollected(errors: ReadonlyArray<Error>): void {
  const messages = [...new Set(errors.map((error) => error.message))];
  const [only] = messages;
  if (only == null) {
    return;
  }
  if (messages.length === 1) {
    throw new Error(only);
  }
  throw new Error(
    `${messages.length} env vars cannot be emitted:\n${messages.map((message) => `- ${message}`).join("\n")}`,
  );
}

function describeEntry(entry: ResolvedEntry): string {
  if (entry.kind === "static") {
    return `literal "${entry.value}"`;
  }
  if (entry.kind === "template") {
    return `template ${JSON.stringify(entry.mapping.parts)}`;
  }
  return `logical id prefix "${entry.mapping.logicalIdPrefix}"${entry.mapping.transform == null ? "" : ` (${entry.mapping.transform.kind})`}${entry.mapping.stackName == null ? "" : ` in stack "${entry.mapping.stackName}"`}`;
}

function resolveEntry(props: {
  readonly entry: ExtractedEnvEntry;
  readonly multiStack: boolean;
}): ResolvedEntry {
  const resolved = resolveEntryValue(props.entry);
  const { stackName } = props.entry;
  if (!props.multiStack || stackName == null) {
    return resolved;
  }
  if (resolved.kind === "resource") {
    return { kind: "resource", mapping: { ...resolved.mapping, stackName } };
  }
  if (resolved.kind === "template") {
    return {
      kind: "template",
      mapping: {
        ...resolved.mapping,
        parts: resolved.mapping.parts.map((part) =>
          typeof part === "string" ? part : { ...part, stackName },
        ),
      },
    };
  }
  return resolved;
}

/**
 * Rules for turning a CloudFormation intrinsic into a resolver mapping, tried in order. A rule
 * returns `undefined` when the intrinsic is not its case; add new special cases here.
 */
const intrinsicRules: ReadonlyArray<IntrinsicRule> = [refRule, getAttributeRule, joinRule];

interface IntrinsicRule {
  (props: { readonly envVar: string; readonly intrinsic: Intrinsic }): ResolvedEntry | undefined;
}

function resolveEntryValue(entry: ExtractedEnvEntry): ResolvedEntry {
  if (typeof entry.value === "string") {
    return { kind: "static", value: entry.value };
  }
  const { intrinsic } = entry.value;
  const resolved = resolveIntrinsic({ envVar: entry.envVar, intrinsic });
  if (resolved == null) {
    throw unsupportedIntrinsic(entry.envVar, intrinsic);
  }
  return resolved;
}

function resolveIntrinsic(props: {
  readonly envVar: string;
  readonly intrinsic: Intrinsic;
}): ResolvedEntry | undefined {
  for (const rule of intrinsicRules) {
    const resolved = rule(props);
    if (resolved != null) {
      return resolved;
    }
  }
  return undefined;
}

/** `Fn::Join` mixing literal text with resolvable intrinsics becomes a template mapping. */
function joinRule(props: {
  readonly envVar: string;
  readonly intrinsic: Intrinsic;
}): ResolvedEntry | undefined {
  const { envVar, intrinsic } = props;
  const join = intrinsic["Fn::Join"];
  if (!Array.isArray(join) || Object.keys(intrinsic).length !== 1) {
    return undefined;
  }
  const [separator, items] = join;
  if (typeof separator !== "string" || !Array.isArray(items)) {
    return undefined;
  }
  const parts = items.flatMap((item: unknown, index) => [
    ...(index === 0 || separator === "" ? [] : [separator]),
    ...templateParts({ envVar, item }),
  ]);
  return { kind: "template", mapping: { envVar, parts } };
}

function templateParts(props: {
  readonly envVar: string;
  readonly item: unknown;
}): ReadonlyArray<string | EmittedResourceReference> {
  const { envVar, item } = props;
  if (typeof item === "string") {
    return [item];
  }
  if (typeof item !== "object" || item == null || Array.isArray(item)) {
    throw unsupportedIntrinsic(envVar, { value: item });
  }
  const intrinsic = Object.fromEntries(Object.entries(item));
  const resolved = resolveIntrinsic({ envVar, intrinsic });
  if (resolved == null) {
    throw unsupportedIntrinsic(envVar, intrinsic);
  }
  if (resolved.kind === "template") {
    return resolved.mapping.parts;
  }
  if (resolved.kind === "resource") {
    const { logicalIdPrefix, resourceType, transform, stackName } = resolved.mapping;
    return [{ logicalIdPrefix, resourceType, transform, stackName }];
  }
  return [resolved.value];
}

function refRule(props: {
  readonly envVar: string;
  readonly intrinsic: Intrinsic;
}): ResolvedEntry | undefined {
  const { envVar, intrinsic } = props;
  const referencedId = intrinsic.Ref;
  if (typeof referencedId !== "string" || Object.keys(intrinsic).length !== 1) {
    return undefined;
  }
  if (referencedId.startsWith("AWS::")) {
    throw unsupportedIntrinsic(envVar, intrinsic);
  }
  return {
    kind: "resource",
    mapping: { envVar, logicalIdPrefix: stripCdkHash(referencedId) },
  };
}

function getAttributeRule(props: {
  readonly envVar: string;
  readonly intrinsic: Intrinsic;
}): ResolvedEntry | undefined {
  const { envVar, intrinsic } = props;
  const attributeReference = intrinsic["Fn::GetAtt"];
  if (
    !Array.isArray(attributeReference) ||
    attributeReference.length !== 2 ||
    typeof attributeReference[0] !== "string" ||
    typeof attributeReference[1] !== "string" ||
    Object.keys(intrinsic).length !== 1
  ) {
    return undefined;
  }
  return resolveAttribute({
    envVar,
    logicalId: attributeReference[0],
    attribute: attributeReference[1],
  });
}

function resolveAttribute(props: {
  readonly envVar: string;
  readonly logicalId: string;
  readonly attribute: string;
}): ResolvedEntry {
  if (props.attribute !== "Arn") {
    throw new Error(
      `Env var ${props.envVar} uses Fn::GetAtt attribute "${props.attribute}" on ${props.logicalId}, which the resolver cannot produce (only physical ids and Lambda ARNs). Pass it via staticEnv or map it by hand.`,
    );
  }
  return {
    kind: "resource",
    mapping: {
      envVar: props.envVar,
      logicalIdPrefix: stripCdkHash(props.logicalId),
      transform: { kind: "lambdaArn" },
    },
  };
}

function unsupportedIntrinsic(envVar: string, intrinsic: Intrinsic): Error {
  const kind = Object.keys(intrinsic).join(", ");
  return new Error(
    `Env var ${envVar} uses CloudFormation intrinsic "${kind}" which @beesolve/aws-env-resolver does not support yet: ${JSON.stringify(intrinsic)}. ` +
      `Workaround: pass the value via \`staticEnv\` or map it by hand in a .ts config. ` +
      `To support it, add a rule to \`inlineRules\` (cdk.ts, values the stack can answer at synth) or \`intrinsicRules\` (src/emit.ts, resource lookups) in packages/aws-env-resolver and open a PR at https://github.com/BeeSolve/packages.`,
  );
}
