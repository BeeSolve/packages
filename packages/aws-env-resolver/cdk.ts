import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Stack, Token } from "aws-cdk-lib";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { RegionInfo } from "aws-cdk-lib/region-info";
import type { IConstruct } from "constructs";
import * as v from "valibot";

import type { EmittedConfig, ExtractedEnvEntry, Intrinsic } from "./src/emit.ts";
import { buildEmittedTarget, defaultTarget } from "./src/emit.ts";
import { stageSchema } from "./src/loadConfig.ts";

/** A CDK-derived env value the resolver looks up in the deployed stack. Produced by {@link envOf}. */
export interface EnvResource {
  readonly kind: "resource";
  readonly intrinsic: Intrinsic;
  readonly stackName: string;
  readonly region: string;
}

/** A value read from Secrets Manager. Produced by {@link secret}. */
export interface EnvSecret {
  readonly kind: "secret";
  readonly secretId: string;
  readonly jsonKey?: string;
}

/** One env var value: a literal, a resource of the deployed stack, or a secret. */
export type DevEnvValue = string | EnvResource | EnvSecret;

/** Input for {@link generateDevEnv} and {@link devEnv}. */
export interface DevEnvProps {
  /** Becomes `projectKey` in the emitted config. */
  readonly projectName: string;
  /**
   * The env the local process gets. Compose it from {@link envOf}, {@link secret} and literals;
   * later keys win, so spread order is precedence.
   */
  readonly env: Record<string, DevEnvValue>;
  /** AWS profile to bake into the emitted config. */
  readonly profile?: string;
}

/**
 * Read the environment of the Lambda function(s) under a construct as values to spread into
 * `env`. Pass a function, or a construct containing functions (an auth gateway, a site, a stack).
 * Throws when the Lambdas under the construct set one env var to different values; pass a
 * narrower construct (for example `construct.node.findChild("Api")`) in that case.
 */
export function envOf(construct: IConstruct): Record<string, DevEnvValue> {
  const functions = construct.node.findAll().filter((node) => node instanceof CfnFunction);
  if (functions.length === 0) {
    throw new Error(
      `Construct "${construct.node.path}" contains no Lambda function. Pass the function itself or a construct that creates one.`,
    );
  }
  const byEnvVar: Record<string, { readonly value: DevEnvValue; readonly source: string }> = {};
  for (const lambdaFunction of functions) {
    for (const entry of extractEntries(lambdaFunction)) {
      const value = toDevEnvValue({ entry, lambdaFunction });
      const existing = byEnvVar[entry.envVar];
      if (existing == null) {
        byEnvVar[entry.envVar] = { value, source: lambdaFunction.node.path };
        continue;
      }
      if (JSON.stringify(existing.value) !== JSON.stringify(value)) {
        throw new Error(
          `Lambdas under "${construct.node.path}" set env var ${entry.envVar} to different values: ${existing.source} vs ${lambdaFunction.node.path}. Pass a narrower construct to envOf.`,
        );
      }
    }
  }
  return Object.fromEntries(Object.entries(byEnvVar).map(([envVar, { value }]) => [envVar, value]));
}

/** Mark an env var as sourced from Secrets Manager. `jsonKey` defaults to the env var name. */
export function secret(props: { readonly secretId: string; readonly jsonKey?: string }): EnvSecret {
  return { kind: "secret", secretId: props.secretId, jsonKey: props.jsonKey };
}

/**
 * File {@link devEnv} writes when no `path` is given: `aws-env.config.<stage>.json`,
 * or `aws-env.config.json` without a stage. The CLI finds it with `--stage <stage>`.
 */
export function defaultConfigPath(stage?: string): string {
  return stage == null
    ? "aws-env.config.json"
    : `aws-env.config.${v.parse(stageSchema, stage)}.json`;
}

/**
 * Turn the composed env into the resolver mapping. Literals stay literal, {@link envOf} values
 * become lookups on the stack's logical-id prefixes, and {@link secret} values become secret
 * mappings. Performs no I/O and never emits resolved physical names.
 */
export function generateDevEnv(props: DevEnvProps): EmittedConfig {
  const resources = Object.values(props.env).flatMap((value) =>
    typeof value === "string" || value.kind === "secret" ? [] : [value],
  );
  const [first] = resources;
  if (first == null) {
    throw new Error(
      "The env has no value from envOf(), so the stack and region are unknown. Spread envOf(<construct>) into env.",
    );
  }
  const regions = [...new Set(resources.map((resource) => resource.region))];
  if (regions.length > 1) {
    throw new Error(
      `The env spans multiple regions (${regions.join(", ")}). The resolver reads one region; use envOf() on constructs in a single region.`,
    );
  }
  const stackNames = [...new Set(resources.map((resource) => resource.stackName))];
  const target = buildEmittedTarget({
    stackName: stackNames,
    region: first.region,
    profile: props.profile,
    entries: Object.entries(props.env).map(([envVar, value]) => toEntry({ envVar, value })),
  });
  return { projectKey: props.projectName, targets: { [defaultTarget]: target } };
}

/** Write an emitted config to `options.path` as JSON, creating parent directories. */
export function persistDevEnv(config: EmittedConfig, options: { readonly path: string }): void {
  mkdirSync(dirname(options.path), { recursive: true });
  writeFileSync(options.path, `${JSON.stringify(config, null, 2)}\n`);
}

/** {@link generateDevEnv} followed by {@link persistDevEnv}; returns the generated config. */
export function devEnv(
  props: DevEnvProps & {
    /** Stage this config is for; picks the default path `aws-env.config.<stage>.json`. */
    readonly stage?: string;
    /** Output path; overrides the stage-derived default. */
    readonly path?: string;
  },
): EmittedConfig {
  const config = generateDevEnv(props);
  persistDevEnv(config, { path: props.path ?? defaultConfigPath(props.stage) });
  return config;
}

function toDevEnvValue(props: {
  readonly entry: ExtractedEnvEntry;
  readonly lambdaFunction: CfnFunction;
}): DevEnvValue {
  const { entry, lambdaFunction } = props;
  if (typeof entry.value === "string") {
    return entry.value;
  }
  const stack = Stack.of(lambdaFunction);
  if (Token.isUnresolved(stack.region) || Token.isUnresolved(stack.stackName)) {
    throw new Error(
      `Stack "${stack.node.path}" has an unresolved region or stack name. Set env.region and an explicit stackName on the stack.`,
    );
  }
  return {
    kind: "resource",
    intrinsic: entry.value.intrinsic,
    stackName: stack.stackName,
    region: stack.region,
  };
}

function toEntry(props: {
  readonly envVar: string;
  readonly value: DevEnvValue;
}): ExtractedEnvEntry {
  const { envVar, value } = props;
  if (typeof value === "string") {
    return { envVar, value };
  }
  if (value.kind === "secret") {
    return {
      envVar,
      value: `{{resolve:secretsmanager:${value.secretId}:SecretString:${value.jsonKey ?? envVar}::}}`,
    };
  }
  return { envVar, value: { intrinsic: value.intrinsic }, stackName: value.stackName };
}

const resolvedEnvironmentSchema = v.object({
  variables: v.optional(
    v.record(v.string(), v.union([v.string(), v.record(v.string(), v.unknown())])),
  ),
});

function extractEntries(lambdaFunction: CfnFunction): ReadonlyArray<ExtractedEnvEntry> {
  const stack = Stack.of(lambdaFunction);
  const resolved = inlineStatic({ value: stack.resolve(lambdaFunction.environment), stack });
  if (resolved == null) {
    return [];
  }
  const parsed = v.safeParse(resolvedEnvironmentSchema, resolved);
  if (!parsed.success) {
    throw new Error(
      `Unexpected environment shape on ${lambdaFunction.node.path}: ${v.summarize(parsed.issues)}`,
    );
  }
  return Object.entries(parsed.output.variables ?? {}).map(([envVar, value]) =>
    typeof value === "string" ? { envVar, value } : { envVar, value: { intrinsic: value } },
  );
}

/**
 * Rules that resolve an intrinsic at synth, tried in order, when the stack can already answer it.
 * A rule returns `undefined` when the intrinsic is not its case; add new special cases here.
 * `inline` re-applies all rules to a nested value.
 */
const inlineRules: ReadonlyArray<InlineRule> = [pseudoParameterRule, literalJoinRule];

interface InlineRuleProps {
  readonly intrinsic: Record<string, unknown>;
  readonly stack: Stack;
  readonly inline: (value: unknown) => unknown;
}

type InlineRule = (props: InlineRuleProps) => unknown;

function inlineStatic(props: { readonly value: unknown; readonly stack: Stack }): unknown {
  const { value, stack } = props;
  const inline = (nested: unknown) => inlineStatic({ value: nested, stack });
  if (Array.isArray(value)) {
    return value.map((item: unknown) => inline(item));
  }
  if (typeof value !== "object" || value == null) {
    return value;
  }
  for (const rule of inlineRules) {
    const inlined = rule({ intrinsic: Object.fromEntries(Object.entries(value)), stack, inline });
    if (inlined != null) {
      return inlined;
    }
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, inline(item)]));
}

/** `{ Ref: "AWS::Region" }` and friends, answered from the stack. */
function pseudoParameterRule({ intrinsic, stack }: InlineRuleProps): unknown {
  const name = intrinsic.Ref;
  if (typeof name !== "string" || Object.keys(intrinsic).length !== 1) {
    return undefined;
  }
  const regionInfo = Token.isUnresolved(stack.region) ? undefined : RegionInfo.get(stack.region);
  if (name === "AWS::Region") {
    return regionInfo == null ? undefined : stack.region;
  }
  if (name === "AWS::AccountId") {
    return Token.isUnresolved(stack.account) ? undefined : stack.account;
  }
  if (name === "AWS::Partition") {
    return regionInfo?.partition;
  }
  if (name === "AWS::URLSuffix") {
    return regionInfo?.domainSuffix;
  }
  return undefined;
}

/** `Fn::Join` whose parts all resolve to strings collapses to one string. */
function literalJoinRule({ intrinsic, inline }: InlineRuleProps): unknown {
  const join = intrinsic["Fn::Join"];
  if (!Array.isArray(join) || Object.keys(intrinsic).length !== 1) {
    return undefined;
  }
  const [separator, parts] = join;
  if (typeof separator !== "string" || !Array.isArray(parts)) {
    return undefined;
  }
  const inlined = parts.map((part: unknown) => inline(part));
  return inlined.every((part) => typeof part === "string") ? inlined.join(separator) : undefined;
}
