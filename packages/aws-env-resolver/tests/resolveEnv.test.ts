import { describe, expect, it } from "bun:test";

import type { ResolveEnvOptions } from "../index.ts";
import type { ResolveEnvDeps } from "../src/resolveEnv.ts";
import { resolveEnvWithDeps } from "../src/resolveEnv.ts";
import type { SecretStore } from "../src/secretStore.ts";

interface SetCall {
  readonly key: string;
  readonly value: string;
  readonly trusted: boolean;
}

interface Harness {
  readonly deps: ResolveEnvDeps;
  readonly cache: Map<string, Record<string, string>>;
  readonly store: Map<string, string>;
  readonly setCalls: Array<SetCall>;
  readonly writeCalls: Array<Record<string, string>>;
  readonly counts: {
    resources: number;
    secrets: number;
    storeGets: number;
    storeCreations: number;
  };
}

function makeHarness(props: {
  readonly cached?: Record<string, string>;
  readonly stored?: Record<string, string>;
  readonly resources: Record<string, string>;
  readonly secrets: Record<string, string>;
}): Harness {
  const cache = new Map<string, Record<string, string>>();
  if (props.cached != null) {
    cache.set("entry", props.cached);
  }
  const store = new Map<string, string>(Object.entries(props.stored ?? {}));
  const setCalls: Array<SetCall> = [];
  const writeCalls: Array<Record<string, string>> = [];
  const counts = { resources: 0, secrets: 0, storeGets: 0, storeCreations: 0 };

  const fakeStore: SecretStore = {
    get(key) {
      counts.storeGets += 1;
      return Promise.resolve(store.get(key));
    },
    set(setProps) {
      setCalls.push(setProps);
      store.set(setProps.key, setProps.value);
      return Promise.resolve();
    },
    purge() {
      store.clear();
      return Promise.resolve();
    },
  };

  const deps: ResolveEnvDeps = {
    readCache() {
      const values = cache.get("entry");
      return values == null ? undefined : { values };
    },
    writeCache(writeProps) {
      writeCalls.push(writeProps.values);
      cache.set("entry", writeProps.values);
    },
    purgeCache() {
      cache.clear();
    },
    createSecretStore() {
      counts.storeCreations += 1;
      return fakeStore;
    },
    resolveStackResources() {
      counts.resources += 1;
      return Promise.resolve(props.resources);
    },
    resolveSecrets() {
      counts.secrets += 1;
      return Promise.resolve(props.secrets);
    },
    platform: "darwin",
  };

  return { deps, cache, store, setCalls, writeCalls, counts };
}

function makeOptions(overrides: Partial<ResolveEnvOptions> = {}): ResolveEnvOptions {
  return {
    projectKey: "example-app",
    namespace: "example-ns",
    config: {
      region: "eu-central-1",
      stackName: "example-stack",
      secretId: "example/secrets",
      staticEnv: { BASE_URI: "https://example.test" },
    },
    resources: [{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }],
    secrets: [{ envVar: "API_KEY" }, { envVar: "HMAC_SECRET" }],
    ...overrides,
  };
}

describe("resolveEnvWithDeps", () => {
  it("makes zero AWS calls when cache and store are warm", async () => {
    const harness = makeHarness({
      cached: { DATA_TABLE_NAME: "cached-table" },
      stored: { API_KEY: "stored-key", HMAC_SECRET: "stored-hmac" },
      resources: {},
      secrets: {},
    });

    const env = await resolveEnvWithDeps(makeOptions(), harness.deps);

    expect(harness.counts.resources).toBe(0);
    expect(harness.counts.secrets).toBe(0);
    expect(harness.setCalls).toHaveLength(0);
    expect(env).toEqual({
      BASE_URI: "https://example.test",
      DATA_TABLE_NAME: "cached-table",
      API_KEY: "stored-key",
      HMAC_SECRET: "stored-hmac",
    });
  });

  it("refetches everything and rewrites caches on refresh", async () => {
    const harness = makeHarness({
      cached: { DATA_TABLE_NAME: "cached-table" },
      stored: { API_KEY: "old-key", HMAC_SECRET: "old-hmac" },
      resources: { DATA_TABLE_NAME: "fresh-table" },
      secrets: { API_KEY: "fresh-key", HMAC_SECRET: "fresh-hmac" },
    });

    const env = await resolveEnvWithDeps(makeOptions({ refresh: true }), harness.deps);

    expect(harness.counts.resources).toBe(1);
    expect(harness.counts.secrets).toBe(1);
    expect(harness.writeCalls).toEqual([{ DATA_TABLE_NAME: "fresh-table" }]);
    expect(harness.setCalls.map((call) => call.key).sort()).toEqual(["API_KEY", "HMAC_SECRET"]);
    expect(env.API_KEY).toBe("fresh-key");
    expect(env.DATA_TABLE_NAME).toBe("fresh-table");
  });

  it("fetches a missing secret once and stores it with the trusted flag", async () => {
    const trustedHarness = makeHarness({
      cached: { DATA_TABLE_NAME: "cached-table" },
      stored: { API_KEY: "stored-key" },
      resources: {},
      secrets: { API_KEY: "fetched-key", HMAC_SECRET: "fetched-hmac" },
    });
    await resolveEnvWithDeps(makeOptions({ trusted: true }), trustedHarness.deps);

    expect(trustedHarness.counts.secrets).toBe(1);
    expect(trustedHarness.setCalls).toHaveLength(2);
    expect(trustedHarness.setCalls.every((call) => call.trusted)).toBe(true);

    const defaultHarness = makeHarness({
      cached: { DATA_TABLE_NAME: "cached-table" },
      resources: {},
      secrets: { API_KEY: "fetched-key", HMAC_SECRET: "fetched-hmac" },
    });
    await resolveEnvWithDeps(makeOptions(), defaultHarness.deps);

    expect(defaultHarness.setCalls).toHaveLength(2);
    expect(defaultHarness.setCalls.every((call) => !call.trusted)).toBe(true);
  });

  it("applies precedence static < resources < secrets", async () => {
    const harness = makeHarness({
      resources: { SHARED: "from-resource", RESOURCE_OVER_STATIC: "from-resource" },
      secrets: { SHARED: "from-secret" },
    });
    const options = makeOptions({
      config: {
        region: "eu-central-1",
        stackName: "example-stack",
        secretId: "example/secrets",
        staticEnv: {
          SHARED: "from-static",
          RESOURCE_OVER_STATIC: "from-static",
          STATIC_ONLY: "from-static",
        },
      },
      secrets: [{ envVar: "SHARED" }],
    });

    const env = await resolveEnvWithDeps(options, harness.deps);

    expect(env.SHARED).toBe("from-secret");
    expect(env.RESOURCE_OVER_STATIC).toBe("from-resource");
    expect(env.STATIC_ONLY).toBe("from-static");
  });

  it("never passes secrets to the cache writer", async () => {
    const harness = makeHarness({
      resources: { DATA_TABLE_NAME: "table" },
      secrets: { API_KEY: "secret-key", HMAC_SECRET: "secret-hmac" },
    });

    await resolveEnvWithDeps(makeOptions(), harness.deps);

    expect(harness.writeCalls).toEqual([{ DATA_TABLE_NAME: "table" }]);
    expect(JSON.stringify(harness.writeCalls)).not.toContain("secret-");
    expect(JSON.stringify([...harness.cache.values()])).not.toContain("secret-");
  });

  it("skips the store and secret fetch when no secrets are configured", async () => {
    const harness = makeHarness({
      cached: { DATA_TABLE_NAME: "cached-table" },
      resources: {},
      secrets: { API_KEY: "unused" },
    });

    const env = await resolveEnvWithDeps(makeOptions({ secrets: undefined }), harness.deps);

    expect(harness.counts.storeCreations).toBe(0);
    expect(harness.counts.storeGets).toBe(0);
    expect(harness.counts.secrets).toBe(0);
    expect(env).toEqual({ BASE_URI: "https://example.test", DATA_TABLE_NAME: "cached-table" });
  });
});
