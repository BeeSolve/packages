import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Stack, Token } from "aws-cdk-lib";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import type { IConstruct } from "constructs";
import * as v from "valibot";

import type { EmittedConfig, ExtractedEnvEntry } from "./src/emit.ts";
import { buildEmittedConfig } from "./src/emit.ts";

/** Input for {@link generate} and {@link generateAndPersist}. */
export interface AllowEnvResolutionProps {
  /** Becomes `projectKey` in the emitted config. */
  readonly projectName: string;
  /** Opaque namespace label for this synth. Not written into the emitted config. */
  readonly namespace: string;
  /** Scope to introspect, usually the `App` or a `Stage`. */
  readonly scope: IConstruct;
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

/**
 * Walk the scope, read every Lambda function's environment, and return the resolver mapping.
 * Performs no I/O. Emits the recipe (env var to logical id prefix), never resolved physical names.
 */
export function generate(props: AllowEnvResolutionProps): EmittedConfig {
  const functions = props.scope.node.findAll().filter((node) => node instanceof CfnFunction);
  const [firstFunction] = functions;
  if (firstFunction == null) {
    throw new Error(`No Lambda functions found under scope "${props.scope.node.path}"`);
  }

  const stack = singleStack(functions);
  if (Token.isUnresolved(stack.region) || Token.isUnresolved(stack.stackName)) {
    throw new Error(
      `Stack "${stack.node.path}" has an unresolved region or stack name. Set env.region and an explicit stackName on the stack.`,
    );
  }

  return buildEmittedConfig({
    projectName: props.projectName,
    stackName: stack.stackName,
    region: stack.region,
    profile: props.profile,
    entries: functions.flatMap((lambdaFunction) => extractEntries(lambdaFunction)),
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
  props: AllowEnvResolutionProps & { readonly path: string },
): EmittedConfig {
  const config = generate(props);
  persist(config, { path: props.path });
  return config;
}

const resolvedEnvironmentSchema = v.object({
  variables: v.optional(
    v.record(v.string(), v.union([v.string(), v.record(v.string(), v.unknown())])),
  ),
});

function singleStack(functions: ReadonlyArray<CfnFunction>): Stack {
  const stacks = [...new Set(functions.map((lambdaFunction) => Stack.of(lambdaFunction)))];
  const [stack] = stacks;
  if (stack == null || stacks.length > 1) {
    throw new Error(
      `Lambda functions span multiple stacks (${stacks.map((candidate) => candidate.node.path).join(", ")}). Pass a narrower scope that contains a single stack.`,
    );
  }
  return stack;
}

function extractEntries(lambdaFunction: CfnFunction): ReadonlyArray<ExtractedEnvEntry> {
  const resolved: unknown = Stack.of(lambdaFunction).resolve(lambdaFunction.environment);
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
