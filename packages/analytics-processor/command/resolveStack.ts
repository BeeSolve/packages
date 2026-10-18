import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

/**
 * The CloudFormation output keys the {@link AnalyticsProcessor} construct
 * publishes. Kept in sync with `publishConfigOutputs` in `cdk.ts`.
 */
export const analyticsOutputKeys = {
  tableName: "AnalyticsTableName",
  reverseIndexName: "AnalyticsReverseIndexName",
  athenaDatabase: "AnalyticsAthenaDatabase",
  athenaTable: "AnalyticsAthenaTable",
  athenaV1Table: "AnalyticsAthenaV1Table",
  athenaWorkgroup: "AnalyticsAthenaWorkgroup",
  athenaOutputLocation: "AnalyticsAthenaOutputLocation",
  topPaths: "AnalyticsTopPaths",
  hourlyTtlDays: "AnalyticsHourlyTtlDays",
} as const;

/**
 * Read a CloudFormation stack's outputs into a `{ outputKey: value }` record.
 * The CLIs use this to resolve their configuration from `--stack <name>` so a
 * caller does not have to pass every value as an environment variable.
 */
export async function resolveStackOutputs({
  stackName,
  client = new CloudFormationClient(),
}: {
  readonly stackName: string;
  readonly client?: Pick<CloudFormationClient, "send">;
}): Promise<Record<string, string>> {
  const response = await client.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = response.Stacks?.[0];
  if (stack == null) {
    throw new Error(`Stack not found: ${stackName}`);
  }

  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey != null && output.OutputValue != null) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }
  return outputs;
}

/**
 * Map resolved stack outputs onto the environment-variable names the command
 * `configFromEnv` parsers expect, so a `--stack` resolution flows through the
 * exact same config path as explicit env vars. Note `ATHENA_TABLE` maps from
 * the v2 table output (the processing table), matching the CLIs' existing env
 * contract.
 */
export function stackOutputsToEnv(outputs: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  const set = (name: string, value: string | undefined): void => {
    if (value != null) env[name] = value;
  };

  set("TABLE_NAME", outputs[analyticsOutputKeys.tableName]);
  set("REVERSE_INDEX_NAME", outputs[analyticsOutputKeys.reverseIndexName]);
  set("ATHENA_DATABASE", outputs[analyticsOutputKeys.athenaDatabase]);
  set("ATHENA_TABLE", outputs[analyticsOutputKeys.athenaTable]);
  set("ATHENA_WORKGROUP", outputs[analyticsOutputKeys.athenaWorkgroup]);
  set("ATHENA_OUTPUT_LOCATION", outputs[analyticsOutputKeys.athenaOutputLocation]);
  set("TOP_PATHS", outputs[analyticsOutputKeys.topPaths]);
  set("HOURLY_TTL_DAYS", outputs[analyticsOutputKeys.hourlyTtlDays]);
  return env;
}

/**
 * Resolve the effective environment for a command: when `stackName` is given,
 * read the stack outputs as a base and let real `process.env` values override
 * them, so an explicit env var always wins over the stack-derived default.
 */
export async function resolveEnv({
  stackName,
  processEnv = process.env,
}: {
  readonly stackName?: string;
  readonly processEnv?: Record<string, string | undefined>;
}): Promise<Record<string, string | undefined>> {
  if (stackName == null) return processEnv;
  const outputs = await resolveStackOutputs({ stackName });
  return { ...stackOutputsToEnv(outputs), ...stripUndefined(processEnv) };
}

function stripUndefined(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value != null) result[key] = value;
  }
  return result;
}

/**
 * Parse `--stack <name>` out of an argv array, returning the stack name (if
 * present) and the argv with that flag pair removed so the command's own
 * argument parser never sees it.
 */
export function extractStackFlag(argv: Array<string>): {
  readonly stackName?: string;
  readonly rest: Array<string>;
} {
  const rest: Array<string> = [];
  let stackName: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stack") {
      stackName = argv[index + 1];
      index += 1;
      continue;
    }
    if (token != null) rest.push(token);
  }

  return { stackName, rest };
}
