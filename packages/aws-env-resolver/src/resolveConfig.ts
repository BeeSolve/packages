import type {
  DescribeStackResourcesCommandOutput,
  StackResource,
} from "@aws-sdk/client-cloudformation";
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import type { GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";

import type { ResolverConfig, ResourceMapping, ResourceTransform } from "../index.ts";

export interface CloudFormationLike {
  send(command: DescribeStackResourcesCommand): Promise<DescribeStackResourcesCommandOutput>;
}

export interface StsLike {
  send(command: GetCallerIdentityCommand): Promise<GetCallerIdentityCommandOutput>;
}

export async function resolveStackResources(props: {
  readonly config: ResolverConfig;
  readonly resources: ReadonlyArray<ResourceMapping>;
  readonly cfnClient?: CloudFormationLike;
  readonly stsClient?: StsLike;
}): Promise<Record<string, string>> {
  const { config, resources } = props;

  if (resources.length === 0) {
    return {};
  }

  const cfnClient = props.cfnClient ?? buildCloudFormationClient(config);
  const response = await cfnClient.send(
    new DescribeStackResourcesCommand({ StackName: config.stackName }),
  );
  const stackResources = response.StackResources ?? [];

  const resolveAccountId = makeAccountIdResolver({
    config,
    stsClient: props.stsClient,
  });

  const resolved: Record<string, string> = {};
  for (const mapping of resources) {
    const matched = findMatchingResource({ stackResources, mapping });
    if (matched == null) {
      throw new Error(describeNoMatch({ stackName: config.stackName, mapping }));
    }

    const physicalId = matched.PhysicalResourceId;
    if (physicalId == null) {
      throw new Error(
        `CloudFormation resource matched env var "${mapping.envVar}" (logicalIdPrefix "${mapping.logicalIdPrefix}") but has no PhysicalResourceId.`,
      );
    }

    resolved[mapping.envVar] = await applyTransform({
      transform: mapping.transform,
      physicalId,
      region: config.region,
      resolveAccountId,
    });
  }

  return resolved;
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
  readonly stackResources: ReadonlyArray<StackResource>;
  readonly mapping: ResourceMapping;
}): StackResource | undefined {
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
  readonly stackName: string;
  readonly mapping: ResourceMapping;
}): string {
  const { stackName, mapping } = props;
  const typeClause = mapping.resourceType != null ? `, resourceType "${mapping.resourceType}"` : "";
  return `No CloudFormation resource in stack "${stackName}" matched env var "${mapping.envVar}" (logicalIdPrefix "${mapping.logicalIdPrefix}"${typeClause}).`;
}
