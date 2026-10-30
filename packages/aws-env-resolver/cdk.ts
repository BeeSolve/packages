import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Stack, Token } from "aws-cdk-lib";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { RegionInfo } from "aws-cdk-lib/region-info";
import type { IConstruct } from "constructs";
import * as v from "valibot";

import type { EmittedConfig, EmittedTarget, ExtractedEnvEntry } from "./src/emit.ts";
import { buildEmittedTarget, defaultTarget } from "./src/emit.ts";
import { stageSchema, targetSchema } from "./src/loadConfig.ts";

const traceKey = Symbol.for("@beesolve/aws-env-resolver/trace");

const traceSchema = v.array(v.string());

/** Options for {@link traceEnv}. */
export interface TraceEnvOptions {
  /**
   * Target(s) the traced Lambdas belong to, e.g. `"web"`. Each target is resolved on its own, so
   * the same env var may point at different resources in different targets. Defaults to
   * `"default"`.
   */
  readonly target?: string | ReadonlyArray<string>;
}

/** Input for {@link generate} and {@link generateAndPersist}. */
export interface AllowEnvResolutionProps {
  /** Becomes `projectKey` in the emitted config. */
  readonly projectName: string;
  /**
   * Scope(s) searched for constructs marked with {@link traceEnv}: an `App`, a `Stage`, a `Stack`,
   * or a list of any of these. List the stacks you want emitted to leave out others, e.g. stacks
   * in another region.
   */
  readonly scope: IConstruct | ReadonlyArray<IConstruct>;
  /** AWS profile to bake into the emitted config. */
  readonly profile?: string;
  /** Secret id plus the env vars sourced from it; the walk cannot infer these. Applies to every target. */
  readonly secrets?: ReadonlyArray<{
    readonly secretId: string;
    readonly envVars: ReadonlyArray<string>;
  }>;
  /** Extra static env the walk will not see. Wins over literals found in lambda environments. Applies to every target. */
  readonly staticEnv?: Record<string, string>;
}

/**
 * Mark a construct whose Lambda environment variables the resolver should emit. Pass a Lambda
 * function, or any construct that contains one (an auth gateway, a SvelteKit site, a whole
 * stack): every Lambda function under it is traced. Call it where the construct is created or
 * from `app.ts`; nothing has to be passed through stacks. Calling it again on the same construct
 * adds targets.
 *
 * `traceEnv(app)` traces every Lambda in the app.
 */
export function traceEnv(construct: IConstruct, options: TraceEnvOptions = {}): void {
  const requested = toTargetNames(options.target);
  const targets = requested.length === 0 ? [defaultTarget] : requested;
  for (const target of targets) {
    v.parse(targetSchema, target);
  }
  Reflect.set(construct, traceKey, [...new Set([...readTraceTargets(construct), ...targets])]);
}

/**
 * File {@link generateAndPersist} writes when no `path` is given: `aws-env.config.<stage>.json`,
 * or `aws-env.config.json` without a stage. The CLI finds it with `--stage <stage>`.
 */
export function defaultConfigPath(stage?: string): string {
  return stage == null
    ? "aws-env.config.json"
    : `aws-env.config.${v.parse(stageSchema, stage)}.json`;
}

/**
 * Walk the scope, read the environment of every Lambda function under a construct marked with
 * {@link traceEnv}, and return the resolver mapping, one entry per target. A target's stacks
 * must share one region.
 * Performs no I/O. Emits the recipe (env var to logical id prefix), never resolved physical names.
 */
export function generate(props: AllowEnvResolutionProps): EmittedConfig {
  const scopes = isConstruct(props.scope) ? [props.scope] : props.scope;
  const scopeLabel = scopes.map((scope) => scope.node.path).join(", ");
  const traced = [...new Set(scopes.flatMap((scope) => scope.node.findAll()))].filter(
    (node) => readTraceTargets(node).length > 0,
  );
  if (traced.length === 0) {
    throw new Error(
      `No constructs marked with traceEnv() found under scope "${scopeLabel}". Call traceEnv(<lambda or construct containing one>) for each runtime whose env you need.`,
    );
  }

  const functionsByTarget = groupFunctionsByTarget(traced);
  const targets: Record<string, EmittedTarget> = {};
  for (const [target, functions] of Object.entries(functionsByTarget)) {
    targets[target] = buildTarget({ props, target, functions: [...functions] });
  }
  return { projectKey: props.projectName, targets };
}

/** Write an emitted config to `options.path` as JSON, creating parent directories. */
export function persist(config: EmittedConfig, options: { readonly path: string }): void {
  mkdirSync(dirname(options.path), { recursive: true });
  writeFileSync(options.path, `${JSON.stringify(config, null, 2)}\n`);
}

/** {@link generate} followed by {@link persist}; returns the generated config. */
export function generateAndPersist(
  props: AllowEnvResolutionProps & {
    /** Stage this config is for; picks the default path `aws-env.config.<stage>.json`. */
    readonly stage?: string;
    /** Output path; overrides the stage-derived default. */
    readonly path?: string;
  },
): EmittedConfig {
  const config = generate(props);
  persist(config, { path: props.path ?? defaultConfigPath(props.stage) });
  return config;
}

function toTargetNames(target: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  if (target == null) {
    return [];
  }
  return typeof target === "string" ? [target] : target;
}

function readTraceTargets(construct: IConstruct): ReadonlyArray<string> {
  const parsed = v.safeParse(traceSchema, Reflect.get(construct, traceKey));
  return parsed.success ? parsed.output : [];
}

function groupFunctionsByTarget(
  traced: ReadonlyArray<IConstruct>,
): Record<string, Set<CfnFunction>> {
  const functionsByTarget: Record<string, Set<CfnFunction>> = {};
  for (const construct of traced) {
    const functions = construct.node.findAll().filter((node) => node instanceof CfnFunction);
    if (functions.length === 0) {
      throw new Error(
        `Construct "${construct.node.path}" is marked with traceEnv() but contains no Lambda function. Trace the function itself or a construct that creates one.`,
      );
    }
    for (const target of readTraceTargets(construct)) {
      const group = (functionsByTarget[target] ??= new Set());
      for (const lambdaFunction of functions) {
        group.add(lambdaFunction);
      }
    }
  }
  return functionsByTarget;
}

function buildTarget(input: {
  readonly props: AllowEnvResolutionProps;
  readonly target: string;
  readonly functions: ReadonlyArray<CfnFunction>;
}): EmittedTarget {
  const { props, target, functions } = input;
  const stackEntries = collectStackEntries(functions);
  const withEnv = stackEntries.filter((stackEntry) => stackEntry.entries.length > 0);
  const included = withEnv.length === 0 ? stackEntries : withEnv;
  const [first] = included;
  if (first == null) {
    throw new Error(`Target "${target}" has no Lambda functions`);
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
      `Target "${target}" spans multiple regions (${regions.join(", ")}). The resolver reads one region; trace only the constructs in one region or put the others in another target.`,
    );
  }

  try {
    return buildEmittedTarget({
      stackName: included.map(({ stack }) => stack.stackName),
      region: first.stack.region,
      profile: props.profile,
      entries: included.flatMap((stackEntry) => stackEntry.entries),
      secrets: props.secrets,
      staticEnv: props.staticEnv,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Target "${target}": ${error.message}`, { cause: error });
    }
    throw error;
  }
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
