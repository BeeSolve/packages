import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { fromIni } from "@aws-sdk/credential-providers";

import {
  type AccessManifest,
  parseAccessManifest,
  toAccessManifestParameterName,
} from "./manifest";

const endpointPattern = /^([a-z0-9]+)\.dsql\.([a-z0-9-]+)\.on\.aws$/;

/** Splits `<cluster id>.dsql.<region>.on.aws` into its parts. */
export function parseDsqlEndpoint(endpoint: string): {
  readonly clusterId: string;
  readonly region: string;
} {
  const match = endpointPattern.exec(endpoint);
  if (match?.[1] == null || match[2] == null) {
    throw new Error(
      `Not a DSQL cluster endpoint: "${endpoint}" (expected <id>.dsql.<region>.on.aws).`,
    );
  }
  return { clusterId: match[1], region: match[2] };
}

/**
 * Loads the manifest the `DsqlCluster` construct wrote for the cluster behind `endpoint`. The
 * parameter name is derived from the cluster id, and the manifest must name the same cluster,
 * so one stage's manifest cannot be applied to another stage's cluster. Needs `ssm:GetParameter`.
 */
export async function readAccessManifest(props: {
  readonly endpoint: string;
  readonly profile?: string | undefined;
  readonly ssm?: SSMClient;
}): Promise<AccessManifest> {
  const { clusterId, region } = parseDsqlEndpoint(props.endpoint);
  const ssm =
    props.ssm ??
    new SSMClient({
      region,
      ...(props.profile ? { credentials: fromIni({ profile: props.profile }) } : {}),
    });
  const name = toAccessManifestParameterName(clusterId);
  const response = await ssm.send(new GetParameterCommand({ Name: name }));
  const value = response.Parameter?.Value;
  if (value == null) {
    throw new Error(`SSM parameter ${name} has no value.`);
  }

  const manifest = parseAccessManifest(JSON.parse(value));
  if (manifest.clusterId !== clusterId) {
    throw new Error(
      `SSM parameter ${name} describes cluster ${manifest.clusterId}, not ${clusterId}.`,
    );
  }
  return manifest;
}
