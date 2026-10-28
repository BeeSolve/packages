import { describe, expect, it } from "bun:test";

import type {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";

import type { ResolverConfig } from "../index.ts";
import type { SecretsManagerLike } from "../src/secrets.ts";
import { resolveSecrets } from "../src/secrets.ts";

interface FakeSecretsManager {
  readonly client: SecretsManagerLike;
  readonly calls: Array<GetSecretValueCommand>;
}

function makeSecretsManager(secretString: string | undefined): FakeSecretsManager {
  const calls: Array<GetSecretValueCommand> = [];
  const client: SecretsManagerLike = {
    send(command) {
      calls.push(command);
      const output: GetSecretValueCommandOutput = { SecretString: secretString, $metadata: {} };
      return Promise.resolve(output);
    },
  };
  return { client, calls };
}

const config: Pick<ResolverConfig, "profile" | "region" | "secretId"> = {
  region: "eu-central-1",
  secretId: "example/secrets",
};

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (caught) {
    if (caught instanceof Error) {
      return caught;
    }
    throw caught;
  }
  throw new Error("expected the operation to throw");
}

describe("resolveSecrets empty", () => {
  it("returns an empty record without calling Secrets Manager", async () => {
    const sm = makeSecretsManager(undefined);

    const resolved = await resolveSecrets({ config, secrets: [], client: sm.client });

    expect(resolved).toEqual({});
    expect(sm.calls).toHaveLength(0);
  });
});

describe("resolveSecrets happy path", () => {
  it("parses the secret JSON and maps each env var", async () => {
    const sm = makeSecretsManager(JSON.stringify({ API_KEY: "a", HMAC_SECRET: "b" }));

    const resolved = await resolveSecrets({
      config,
      secrets: [{ envVar: "API_KEY" }, { envVar: "HMAC_SECRET" }],
      client: sm.client,
    });

    expect(resolved).toEqual({ API_KEY: "a", HMAC_SECRET: "b" });
    expect(sm.calls).toHaveLength(1);
  });
});

describe("resolveSecrets jsonKey remap", () => {
  it("reads the configured jsonKey from the secret JSON", async () => {
    const sm = makeSecretsManager(JSON.stringify({ apiKey: "resolved-key" }));

    const resolved = await resolveSecrets({
      config,
      secrets: [{ envVar: "API_KEY", jsonKey: "apiKey" }],
      client: sm.client,
    });

    expect(resolved).toEqual({ API_KEY: "resolved-key" });
  });
});

describe("resolveSecrets missing key", () => {
  it("throws naming the missing key without leaking secret values", async () => {
    const sm = makeSecretsManager(JSON.stringify({ API_KEY: "super-secret-value" }));

    const error = await captureError(() =>
      resolveSecrets({
        config,
        secrets: [{ envVar: "HMAC_SECRET" }],
        client: sm.client,
      }),
    );

    expect(error.message).toContain("HMAC_SECRET");
    expect(error.message).toContain("example/secrets");
    expect(error.message).not.toContain("super-secret-value");
  });
});

describe("resolveSecrets missing secretId", () => {
  it("throws when secrets are requested but no secretId is configured", async () => {
    const sm = makeSecretsManager(undefined);

    const error = await captureError(() =>
      resolveSecrets({
        config: { region: "eu-central-1" },
        secrets: [{ envVar: "API_KEY" }],
        client: sm.client,
      }),
    );

    expect(error.message).toContain("secretId");
    expect(sm.calls).toHaveLength(0);
  });
});
