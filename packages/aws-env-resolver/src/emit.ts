import * as v from "valibot";

export const transformTagSchema = v.object({
  kind: v.picklist(["lambdaArn"] as const),
});

export const emittedResourceMappingSchema = v.object({
  envVar: v.string(),
  logicalIdPrefix: v.string(),
  resourceType: v.optional(v.string()),
  transform: v.optional(transformTagSchema),
});

export const emittedSecretMappingSchema = v.object({
  envVar: v.string(),
  jsonKey: v.optional(v.string()),
});

export const emittedResolverConfigSchema = v.object({
  profile: v.optional(v.string()),
  region: v.string(),
  stackName: v.string(),
  secretId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  staticEnv: v.record(v.string(), v.string()),
});

/** Valibot schema for the JSON config the CDK emitter produces and the CLI loads. */
export const emittedConfigSchema = v.object({
  projectKey: v.string(),
  config: emittedResolverConfigSchema,
  resources: v.array(emittedResourceMappingSchema),
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
}

/** A Secrets Manager secret and the env vars sourced from it. */
export interface SecretSource {
  readonly secretId: string;
  readonly envVars: ReadonlyArray<string>;
}

/** Input for {@link buildEmittedConfig}. */
export interface BuildEmittedConfigProps {
  readonly projectName: string;
  readonly stackName: string;
  readonly region: string;
  readonly profile?: string;
  readonly entries: ReadonlyArray<ExtractedEnvEntry>;
  readonly secrets?: ReadonlyArray<SecretSource>;
  readonly staticEnv?: Record<string, string>;
}

type EmittedResourceMapping = v.InferOutput<typeof emittedResourceMappingSchema>;

type ResolvedEntry =
  | { readonly kind: "static"; readonly value: string }
  | { readonly kind: "resource"; readonly mapping: EmittedResourceMapping };

const cdkHashSuffix = /[0-9A-F]{8}$/;

/**
 * Remove the trailing 8-character uppercase hex hash CDK appends to logical ids.
 * Returns the id unchanged when nothing would remain.
 */
export function stripCdkHash(logicalId: string): string {
  const stripped = logicalId.replace(cdkHashSuffix, "");
  return stripped.length === 0 ? logicalId : stripped;
}

/** Build the declarative resolver config from already-extracted lambda environment data. */
export function buildEmittedConfig(props: BuildEmittedConfigProps): EmittedConfig {
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
  for (const entry of props.entries) {
    if (secretEnvVars.includes(entry.envVar) || entry.envVar in explicitStaticEnv) {
      continue;
    }
    const resolved = resolveEntry(entry);
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

  const walkedStaticEnv: Record<string, string> = {};
  const resources: Array<EmittedResourceMapping> = [];
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
      stackName: props.stackName,
      ...(secretIds[0] == null ? {} : { secretId: secretIds[0] }),
      staticEnv: { ...walkedStaticEnv, ...explicitStaticEnv },
    },
    resources,
    ...(secretEnvVars.length === 0 ? {} : { secrets: secretEnvVars.map((envVar) => ({ envVar })) }),
  };
}

function describeEntry(entry: ResolvedEntry): string {
  if (entry.kind === "static") {
    return `literal "${entry.value}"`;
  }
  return `logical id prefix "${entry.mapping.logicalIdPrefix}"${entry.mapping.transform == null ? "" : ` (${entry.mapping.transform.kind})`}`;
}

function resolveEntry(entry: ExtractedEnvEntry): ResolvedEntry {
  if (typeof entry.value === "string") {
    return { kind: "static", value: entry.value };
  }
  const { intrinsic } = entry.value;
  const referencedId = intrinsic.Ref;
  if (typeof referencedId === "string" && Object.keys(intrinsic).length === 1) {
    if (referencedId.startsWith("AWS::")) {
      throw unsupportedIntrinsic(entry.envVar, intrinsic);
    }
    return {
      kind: "resource",
      mapping: { envVar: entry.envVar, logicalIdPrefix: stripCdkHash(referencedId) },
    };
  }
  const attributeReference = intrinsic["Fn::GetAtt"];
  if (
    Array.isArray(attributeReference) &&
    attributeReference.length === 2 &&
    typeof attributeReference[0] === "string" &&
    typeof attributeReference[1] === "string" &&
    Object.keys(intrinsic).length === 1
  ) {
    return resolveAttribute({
      envVar: entry.envVar,
      logicalId: attributeReference[0],
      attribute: attributeReference[1],
    });
  }
  throw unsupportedIntrinsic(entry.envVar, intrinsic);
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
  return new Error(
    `Env var ${envVar} uses an unsupported CloudFormation intrinsic ${JSON.stringify(intrinsic)}. Pass it via staticEnv or map it by hand.`,
  );
}
