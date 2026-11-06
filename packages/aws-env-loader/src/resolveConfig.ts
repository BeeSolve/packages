import type {
  ListStackResourcesCommandOutput,
  StackResourceSummary,
} from "@aws-sdk/client-cloudformation";
import { CloudFormationClient, ListStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import type { GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";

import type {
  ResolverConfig,
  ResourceReference,
  ResourceTransform,
  TemplateMapping,
  ResourceMapping,
} from "../index.ts";
import { toStackNames } from "./emit.ts";

export interface CloudFormationLike {
  send(command: ListStackResourcesCommand): Promise<ListStackResourcesCommandOutput>;
}

export interface StsLike {
  send(command: GetCallerIdentityCommand): Promise<GetCallerIdentityCommandOutput>;
}

export async function resolveStackResources(props: {
  readonly config: ResolverConfig;
  readonly resources: ReadonlyArray<ResourceMapping | TemplateMapping>;
  readonly cfnClient?: CloudFormationLike;
  readonly stsClient?: StsLike;
}): Promise<Record<string, string>> {
  const { config, resources } = props;

  if (resources.length === 0) {
    return {};
  }

  const cfnClient = props.cfnClient ?? buildCloudFormationClient(config);
  const stacks = await Promise.all(
    toStackNames(config.stackName).map(async (stackName) => ({
      stackName,
      stackResources: await listStackResources({ cfnClient, stackName }),
    })),
  );

  const resolveAccountId = makeAccountIdResolver({
    config,
    stsClient: props.stsClient,
  });

  const resolved: Record<string, string> = {};
  for (const mapping of resources) {
    if ("parts" in mapping) {
      const values = await Promise.all(
        mapping.parts.map(async (part) =>
          typeof part === "string"
            ? part
            : resolveReference({
                envVar: mapping.envVar,
                reference: part,
                stacks,
                config,
                resolveAccountId,
              }),
        ),
      );
      resolved[mapping.envVar] = values.join("");
      continue;
    }
    resolved[mapping.envVar] = await resolveReference({
      envVar: mapping.envVar,
      reference: mapping,
      stacks,
      config,
      resolveAccountId,
    });
  }

  return resolved;
}

async function resolveReference(props: {
  readonly envVar: string;
  readonly reference: ResourceReference;
  readonly stacks: ReadonlyArray<{
    readonly stackName: string;
    readonly stackResources: ReadonlyArray<StackResourceSummary>;
  }>;
  readonly config: ResolverConfig;
  readonly resolveAccountId: () => Promise<string>;
}): Promise<string> {
  const { envVar, reference, stacks, config, resolveAccountId } = props;
  const searched = stacks.filter(
    (stack) => reference.stackName == null || stack.stackName === reference.stackName,
  );
  const matched = findMatchingResource({
    stackResources: searched.flatMap((stack) => stack.stackResources),
    mapping: reference,
  });
  if (matched == null) {
    throw new Error(
      describeNoMatch({
        envVar,
        stackNames: searched.map((stack) => stack.stackName),
        mapping: reference,
      }),
    );
  }

  const physicalId = matched.PhysicalResourceId;
  if (physicalId == null) {
    throw new Error(
      `CloudFormation resource matched env var "${envVar}" (logicalIdPrefix "${reference.logicalIdPrefix}") but has no PhysicalResourceId.`,
    );
  }

  return applyTransform({
    transform: reference.transform,
    physicalId,
    region: config.region,
    resolveAccountId,
  });
}

async function listStackResources(props: {
  readonly cfnClient: CloudFormationLike;
  readonly stackName: string;
}): Promise<ReadonlyArray<StackResourceSummary>> {
  const summaries: Array<StackResourceSummary> = [];
  let nextToken: string | undefined;
  do {
    const response = await props.cfnClient.send(
      new ListStackResourcesCommand({ StackName: props.stackName, NextToken: nextToken }),
    );
    summaries.push(...(response.StackResourceSummaries ?? []));
    nextToken = response.NextToken;
  } while (nextToken != null);
  return summaries;
}

function buildCloudFormationClient(
  config: Pick<ResolverConfig, "profile" | "region">,
): CloudFormationClient {
  return new CloudFormationClient({
    region: config.region,
    credentials: config.profile ? fromIni({ profile: config.profile }) : undefined,
  });
}

function buildStsClient(config: Pick<ResolverConfig, "profile" | "region">): STSClient {
  return new STSClient({
    region: config.region,
    credentials: config.profile ? fromIni({ profile: config.profile }) : undefined,
  });
}

function makeAccountIdResolver(props: {
  readonly config: ResolverConfig;
  readonly stsClient?: StsLike;
}): () => Promise<string> {
  const { config } = props;
  if (config.accountId != null) {
    const accountId = config.accountId;
    return () => Promise.resolve(accountId);
  }

  let pending: Promise<string> | undefined;
  return () => {
    if (pending == null) {
      const stsClient = props.stsClient ?? buildStsClient(config);
      pending = fetchAccountId(stsClient);
    }
    return pending;
  };
}

async function fetchAccountId(stsClient: StsLike): Promise<string> {
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  if (identity.Account == null) {
    throw new Error("STS GetCallerIdentity returned no Account for ARN construction.");
  }
  return identity.Account;
}

async function applyTransform(props: {
  readonly transform: ResourceTransform | undefined;
  readonly physicalId: string;
  readonly region: string;
  readonly resolveAccountId: () => Promise<string>;
}): Promise<string> {
  const { transform, physicalId, region, resolveAccountId } = props;

  if (transform == null) {
    return physicalId;
  }

  const accountId = await resolveAccountId();

  if (typeof transform === "function") {
    return transform(physicalId, { region, accountId });
  }

  if (transform.kind === "lambdaArn") {
    return `arn:aws:lambda:${region}:${accountId}:function:${physicalId}`;
  }

  throw new Error(`Unknown transform tag: ${JSON.stringify(transform)}`);
}

function findMatchingResource(props: {
  readonly stackResources: ReadonlyArray<StackResourceSummary>;
  readonly mapping: ResourceReference;
}): StackResourceSummary | undefined {
  const { stackResources, mapping } = props;
  return stackResources.find((resource) => {
    const logicalId = resource.LogicalResourceId;
    if (logicalId == null || !logicalId.startsWith(mapping.logicalIdPrefix)) {
      return false;
    }
    if (mapping.resourceType != null && resource.ResourceType !== mapping.resourceType) {
      return false;
    }
    return true;
  });
}

function describeNoMatch(props: {
  readonly envVar: string;
  readonly stackNames: ReadonlyArray<string>;
  readonly mapping: ResourceReference;
}): string {
  const { envVar, stackNames, mapping } = props;
  const stackClause =
    stackNames.length === 1
      ? `stack "${stackNames[0]}"`
      : `stacks ${stackNames.map((name) => `"${name}"`).join(", ")}`;
  const typeClause = mapping.resourceType != null ? `, resourceType "${mapping.resourceType}"` : "";
  return `No CloudFormation resource in ${stackClause} matched env var "${envVar}" (logicalIdPrefix "${mapping.logicalIdPrefix}"${typeClause}).`;
}
