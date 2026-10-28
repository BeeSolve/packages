import type { GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import * as v from "valibot";

import type { ResolverConfig, SecretMapping } from "../index.ts";

export interface SecretsManagerLike {
  send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput>;
}

const secretJsonSchema = v.record(v.string(), v.string());

export async function resolveSecrets(props: {
  readonly config: Pick<ResolverConfig, "profile" | "region" | "secretId">;
  readonly secrets: ReadonlyArray<SecretMapping>;
  readonly client?: SecretsManagerLike;
}): Promise<Record<string, string>> {
  const { config, secrets } = props;

  if (secrets.length === 0) {
    return {};
  }

  if (config.secretId == null) {
    throw new Error("Secrets were requested but no secretId is configured in ResolverConfig.");
  }

  const client = props.client ?? buildSecretsManagerClient(config);
  const response = await client.send(new GetSecretValueCommand({ SecretId: config.secretId }));

  if (response.SecretString == null) {
    throw new Error(`Secret "${config.secretId}" has no SecretString value.`);
  }

  const json = parseSecretJson({ secretId: config.secretId, secretString: response.SecretString });

  const resolved: Record<string, string> = {};
  for (const mapping of secrets) {
    const jsonKey = mapping.jsonKey ?? mapping.envVar;
    const value = json[jsonKey];
    if (value == null) {
      throw new Error(
        `Secret "${config.secretId}" has no key "${jsonKey}" required for env var "${mapping.envVar}".`,
      );
    }
    resolved[mapping.envVar] = value;
  }

  return resolved;
}

function buildSecretsManagerClient(
  config: Pick<ResolverConfig, "profile" | "region">,
): SecretsManagerClient {
  return new SecretsManagerClient({
    region: config.region,
    credentials: config.profile ? fromIni({ profile: config.profile }) : undefined,
  });
}

function parseSecretJson(props: {
  readonly secretId: string;
  readonly secretString: string;
}): Record<string, string> {
  const parsed = toJsonValue({ secretId: props.secretId, secretString: props.secretString });
  const result = v.safeParse(secretJsonSchema, parsed);
  if (!result.success) {
    throw new Error(
      `Secret "${props.secretId}" is not a JSON object of string values; cannot resolve its keys.`,
    );
  }
  return result.output;
}

function toJsonValue(props: { readonly secretId: string; readonly secretString: string }): unknown {
  try {
    return JSON.parse(props.secretString);
  } catch {
    throw new Error(`Secret "${props.secretId}" is not valid JSON.`);
  }
}
