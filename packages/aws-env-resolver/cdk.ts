import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Stack, Token } from "aws-cdk-lib";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { RegionInfo } from "aws-cdk-lib/region-info";
import type { IConstruct } from "constructs";
import * as v from "valibot";

import type { EmittedConfig, ExtractedEnvEntry } from "./src/emit.ts";
import { buildEmittedConfig } from "./src/emit.ts";

/** Input for {@link generate} and {@link generateAndPersist}. */
export interface AllowEnvResolutionProps {
  /** Becomes `projectKey` in the emitted config. */
  readonly projectName: string;
  /**
   * Scope(s) to introspect: an `App`, a `Stage`, a `Stack`, or a list of any of these. List the
   * stacks you want emitted to leave out others, e.g. stacks in another region.
   */
  readonly scope: IConstruct | ReadonlyArray<IConstruct>;
  /** AWS profile to bake into the emitted config. */
  readonly profile?: string;
  /** Secret id plus the env vars sourced from it; the walk cannot infer these. */
  readonly secrets?: ReadonlyArray<{
    readonly secretId: string;
    readonly envVars: ReadonlyArray<string>;
  }>;
  /** Extra static env the walk will not see. Wins over literals found in lambda environments. */
  readonly staticEnv?: Record<string, string>;
}

/** Default file written by {@link generateAndPersist}. */
export const defaultConfigPath = "aws-env.config.json";

/**
 * Walk the scope, read every Lambda function's environment, and return the resolver mapping.
 * Every stack under the scope with Lambda environment variables is included; all of them must
 * share one region.
 * Performs no I/O. Emits the recipe (env var to logical id prefix), never resolved physical names.
 */
export function generate(props: AllowEnvResolutionProps): EmittedConfig {
  const scopes = isConstruct(props.scope) ? [props.scope] : props.scope;
  const scopeLabel = scopes.map((scope) => scope.node.path).join(", ");
  const functions = [...new Set(scopes.flatMap((scope) => scope.node.findAll()))].filter(
    (node) => node instanceof CfnFunction,
  );
  if (functions.length === 0) {
    throw new Error(`No Lambda functions found under scope "${scopeLabel}"`);
  }

  const stackEntries = collectStackEntries(functions);
  const withEnv = stackEntries.filter((stackEntry) => stackEntry.entries.length > 0);
  const included = withEnv.length === 0 ? stackEntries : withEnv;
  const [first] = included;
  if (first == null) {
    throw new Error(`No Lambda functions found under scope "${scopeLabel}"`);
  }

  for (const { stack } of included) {
    if (Token.isUnresolved(stack.region) || Token.isUnresolved(stack.stackName)) {
      throw new Error(
        `Stack "${stack.node.path}" has an unresolved region or stack name. Set env.region and an explicit stackName on the stack.`,
      );
    }
  }
  const regions = [...new Set(included.map(({ stack }) => stack.region))];
  if (regions.length > 1) {
    throw new Error(
      `Stacks with Lambda environment variables span multiple regions (${regions.join(", ")}). The resolver reads one region; pass the stacks you want as the scope.`,
    );
  }

  return buildEmittedConfig({
    projectName: props.projectName,
    stackName: included.map(({ stack }) => stack.stackName),
    region: first.stack.region,
    profile: props.profile,
    entries: included.flatMap((stackEntry) => stackEntry.entries),
    secrets: props.secrets,
    staticEnv: props.staticEnv,
  });
}

/** Write an emitted config to `options.path` as JSON, creating parent directories. */
export function persist(config: EmittedConfig, options: { readonly path: string }): void {
  mkdirSync(dirname(options.path), { recursive: true });
  writeFileSync(options.path, `${JSON.stringify(config, null, 2)}\n`);
}

/** {@link generate} followed by {@link persist}; returns the generated config. */
export function generateAndPersist(
  props: AllowEnvResolutionProps & { readonly path?: string },
): EmittedConfig {
  const config = generate(props);
  persist(config, { path: props.path ?? defaultConfigPath });
  return config;
}

const resolvedEnvironmentSchema = v.object({
  variables: v.optional(
    v.record(v.string(), v.union([v.string(), v.record(v.string(), v.unknown())])),
  ),
});

function isConstruct(scope: IConstruct | ReadonlyArray<IConstruct>): scope is IConstruct {
  return "node" in scope;
}

function collectStackEntries(
  functions: ReadonlyArray<CfnFunction>,
): ReadonlyArray<{ readonly stack: Stack; readonly entries: ReadonlyArray<ExtractedEnvEntry> }> {
  const stacks = [...new Set(functions.map((lambdaFunction) => Stack.of(lambdaFunction)))];
  return stacks.map((stack) => ({
    stack,
    entries: functions
      .filter((lambdaFunction) => Stack.of(lambdaFunction) === stack)
      .flatMap((lambdaFunction) => extractEntries(lambdaFunction))
      .map((entry) => ({ ...entry, stackName: stack.stackName })),
  }));
}

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
