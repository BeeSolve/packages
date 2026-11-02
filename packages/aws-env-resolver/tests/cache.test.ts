import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import * as v from "valibot";

import {
  type CacheIdentity,
  type CachedResources,
  cacheFilePath,
  computeFingerprint,
  purgeCache,
  readCache,
  writeCache,
} from "../src/cache.ts";

const createdFiles = new Set<string>();

const resources: CachedResources = [{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }];

function makeIdentity(overrides: Partial<CacheIdentity> = {}): CacheIdentity {
  const suffix = Math.random().toString(36).slice(2);
  return {
    projectKey: `example-app-${suffix}`,
    stage: "staging",
    config: {
      region: "eu-central-1",
      stackName: "example-stack",
      secretId: "example/secrets",
    },
    ...overrides,
  };
}

function track(identity: CacheIdentity): CacheIdentity {
  createdFiles.add(cacheFilePath(identity));
  return identity;
}

afterEach(() => {
  for (const filePath of createdFiles) {
    rmSync(filePath, { force: true });
  }
  createdFiles.clear();
});

describe("cache targets", () => {
  it("keeps a separate cache file per target and leaves the default path unchanged", () => {
    const base = makeIdentity();
    const web = track({ ...base, target: "web" });
    const worker = track({ ...base, target: "worker" });

    expect(cacheFilePath(web)).not.toBe(cacheFilePath(worker));
    expect(cacheFilePath(web)).not.toBe(cacheFilePath(base));

    writeCache({ resources, identity: web, values: { TABLE: "web-table" } });

    expect(readCache({ resources, identity: web })?.values).toEqual({ TABLE: "web-table" });
    expect(readCache({ resources, identity: worker })).toBeUndefined();
    expect(readCache({ resources, identity: base })).toBeUndefined();
  });
});

describe("cache", () => {
  it("round-trips written values through a read", () => {
    const identity = track(makeIdentity());
    const values = { DATA_TABLE_NAME: "data-666", EXPORT_BUCKET: "exports-777" };

    writeCache({ resources, identity, values });
    const record = readCache({ resources, identity });

    expect(record).toEqual({ values });
  });

  it("treats an expired cache as a miss", () => {
    const identity = track(makeIdentity());
    writeCache({ resources, identity, values: { DATA_TABLE_NAME: "data-666" } });

    const record = readCache({ resources, identity, cacheTtlMs: -1 });

    expect(record).toBeUndefined();
  });

  it("misses on a fingerprint mismatch and uses a different file path", () => {
    const base = track(makeIdentity());
    writeCache({ resources, identity: base, values: { DATA_TABLE_NAME: "data-666" } });

    const otherStack = track({
      ...base,
      config: { ...base.config, stackName: "other-stack" },
    });

    expect(cacheFilePath(otherStack)).not.toBe(cacheFilePath(base));
    expect(readCache({ resources, identity: otherStack })).toBeUndefined();
  });

  it("removes the file on purge", () => {
    const identity = track(makeIdentity());
    writeCache({ resources, identity, values: { DATA_TABLE_NAME: "data-666" } });
    expect(existsSync(cacheFilePath(identity))).toBe(true);

    purgeCache({ identity });

    expect(existsSync(cacheFilePath(identity))).toBe(false);
    expect(readCache({ resources, identity })).toBeUndefined();
  });

  it("misses when the resource mapping changed since the values were cached", () => {
    const identity = track(makeIdentity());
    writeCache({ resources, identity, values: { DATA_TABLE_NAME: "data-666" } });

    const widened: CachedResources = [
      ...resources,
      { envVar: "SESSIONS_TABLE_NAME", logicalIdPrefix: "AuthSessions" },
    ];

    expect(readCache({ resources: widened, identity })).toBeUndefined();
    expect(readCache({ resources, identity })?.values).toEqual({ DATA_TABLE_NAME: "data-666" });
  });

  it("misses when a function transform changed", () => {
    const identity = track(makeIdentity());
    const before: CachedResources = [
      { envVar: "ARN", logicalIdPrefix: "Fn", transform: (physicalId) => `${physicalId}-a` },
    ];
    const after: CachedResources = [
      { envVar: "ARN", logicalIdPrefix: "Fn", transform: (physicalId) => `${physicalId}-b` },
    ];
    writeCache({ resources: before, identity, values: { ARN: "fn-a" } });

    expect(readCache({ resources: after, identity })).toBeUndefined();
  });

  it("misses on a cache file written before the mapping was recorded", () => {
    const identity = track(makeIdentity());
    writeCache({ resources, identity, values: { DATA_TABLE_NAME: "data-666" } });
    const { resourcesHash: _dropped, ...legacy } = v.parse(
      v.record(v.string(), v.unknown()),
      JSON.parse(readFileSync(cacheFilePath(identity), "utf8")),
    );
    writeFileSync(cacheFilePath(identity), JSON.stringify(legacy));

    expect(readCache({ resources, identity })).toBeUndefined();
  });

  it("purge is a no-op when the file is absent", () => {
    const identity = track(makeIdentity());
    expect(() => purgeCache({ identity })).not.toThrow();
  });

  it("persists only non-secret values and fingerprint inputs", () => {
    const identity = track(makeIdentity());
    const values = { DATA_TABLE_NAME: "data-666" };

    writeCache({ resources, identity, values });

    const onDisk = v.parse(
      v.record(v.string(), v.unknown()),
      JSON.parse(readFileSync(cacheFilePath(identity), "utf8")),
    );

    expect(Object.keys(onDisk).sort()).toEqual([
      "region",
      "resolvedAt",
      "resourcesHash",
      "secretId",
      "stackName",
      "values",
    ]);
    expect(onDisk.values).toEqual(values);
    expect(onDisk.region).toBe(identity.config.region);
    expect(onDisk.stackName).toBe(identity.config.stackName);
    expect(onDisk.secretId).toBe(identity.config.secretId);
  });
});

describe("computeFingerprint", () => {
  it("is stable for equal inputs", () => {
    const inputs = {
      region: "eu-central-1",
      stackName: "example-stack",
      secretId: "example/secrets",
    };

    expect(computeFingerprint(inputs)).toBe(computeFingerprint({ ...inputs }));
  });

  it("differs when region, stackName, or secretId differ", () => {
    const base = {
      region: "eu-central-1",
      stackName: "example-stack",
      secretId: "example/secrets",
    };
    const baseFingerprint = computeFingerprint(base);

    expect(computeFingerprint({ ...base, region: "us-east-1" })).not.toBe(baseFingerprint);
    expect(computeFingerprint({ ...base, stackName: "other-stack" })).not.toBe(baseFingerprint);
    expect(computeFingerprint({ ...base, secretId: "other/secrets" })).not.toBe(baseFingerprint);
  });

  it("distinguishes an unset secretId from a set one", () => {
    const base = { region: "eu-central-1", stackName: "example-stack" };

    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, secretId: "example/secrets" }),
    );
  });
});
