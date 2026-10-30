import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

import * as v from "valibot";

import {
  type CacheIdentity,
  cacheFilePath,
  computeFingerprint,
  purgeCache,
  readCache,
  writeCache,
} from "../src/cache.ts";

const createdFiles = new Set<string>();

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

    writeCache({ identity: web, values: { TABLE: "web-table" } });

    expect(readCache({ identity: web })?.values).toEqual({ TABLE: "web-table" });
    expect(readCache({ identity: worker })).toBeUndefined();
    expect(readCache({ identity: base })).toBeUndefined();
  });
});

describe("cache", () => {
  it("round-trips written values through a read", () => {
    const identity = track(makeIdentity());
    const values = { DATA_TABLE_NAME: "data-666", EXPORT_BUCKET: "exports-777" };

    writeCache({ identity, values });
    const record = readCache({ identity });

    expect(record).toEqual({ values });
  });

  it("treats an expired cache as a miss", () => {
    const identity = track(makeIdentity());
    writeCache({ identity, values: { DATA_TABLE_NAME: "data-666" } });

    const record = readCache({ identity, cacheTtlMs: -1 });

    expect(record).toBeUndefined();
  });

  it("misses on a fingerprint mismatch and uses a different file path", () => {
    const base = track(makeIdentity());
    writeCache({ identity: base, values: { DATA_TABLE_NAME: "data-666" } });

    const otherStack = track({
      ...base,
      config: { ...base.config, stackName: "other-stack" },
    });

    expect(cacheFilePath(otherStack)).not.toBe(cacheFilePath(base));
    expect(readCache({ identity: otherStack })).toBeUndefined();
  });

  it("removes the file on purge", () => {
    const identity = track(makeIdentity());
    writeCache({ identity, values: { DATA_TABLE_NAME: "data-666" } });
    expect(existsSync(cacheFilePath(identity))).toBe(true);

    purgeCache({ identity });

    expect(existsSync(cacheFilePath(identity))).toBe(false);
    expect(readCache({ identity })).toBeUndefined();
  });

  it("purge is a no-op when the file is absent", () => {
    const identity = track(makeIdentity());
    expect(() => purgeCache({ identity })).not.toThrow();
  });

  it("persists only non-secret values and fingerprint inputs", () => {
    const identity = track(makeIdentity());
    const values = { DATA_TABLE_NAME: "data-666" };

    writeCache({ identity, values });

    const onDisk = v.parse(
      v.record(v.string(), v.unknown()),
      JSON.parse(readFileSync(cacheFilePath(identity), "utf8")),
    );

    expect(Object.keys(onDisk).sort()).toEqual([
      "region",
      "resolvedAt",
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
