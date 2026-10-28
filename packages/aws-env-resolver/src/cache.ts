import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as v from "valibot";

/** Default non-secret cache TTL: 24 hours in milliseconds. */
export const defaultCacheTtlMs = 86_400_000;

export interface FingerprintInputs {
  readonly region: string;
  readonly stackName: string;
  readonly secretId?: string;
}

export interface CacheIdentity {
  readonly projectKey: string;
  readonly namespace: string;
  readonly config: FingerprintInputs;
}

export interface CacheRecord {
  readonly values: Record<string, string>;
}

interface StoredCache {
  readonly values: Record<string, string>;
  readonly resolvedAt: number;
  readonly region: string;
  readonly stackName: string;
  readonly secretId?: string;
}

const storedCacheSchema: v.GenericSchema<StoredCache> = v.object({
  values: v.record(v.string(), v.string()),
  resolvedAt: v.number(),
  region: v.string(),
  stackName: v.string(),
  secretId: v.optional(v.string()),
});

/** Short, stable hex fingerprint of the AWS target identity shared by cache file and keychain. */
export function computeFingerprint(inputs: FingerprintInputs): string {
  const serialized = JSON.stringify({
    region: inputs.region,
    stackName: inputs.stackName,
    secretId: inputs.secretId ?? null,
  });
  return createHash("sha256").update(serialized).digest("hex").slice(0, 12);
}

/** Absolute path of the non-secret cache file for a given identity. */
export function cacheFilePath(identity: CacheIdentity): string {
  const fingerprint = computeFingerprint(identity.config);
  const fileName = `${identity.projectKey}-${identity.namespace}-${fingerprint}.json`;
  return join(tmpdir(), "aws-env-resolver", fileName);
}

/** Persist only non-secret resource values plus the fingerprint inputs and a timestamp. */
export function writeCache(props: {
  readonly identity: CacheIdentity;
  readonly values: Record<string, string>;
}): void {
  const filePath = cacheFilePath(props.identity);
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  const stored: StoredCache = {
    values: props.values,
    resolvedAt: Date.now(),
    region: props.identity.config.region,
    stackName: props.identity.config.stackName,
    secretId: props.identity.config.secretId,
  };
  writeFileSync(filePath, JSON.stringify(stored), "utf8");
}

/** Read the cached non-secret values, honoring TTL and a defensive fingerprint-input match. */
export function readCache(props: {
  readonly identity: CacheIdentity;
  readonly cacheTtlMs?: number;
}): CacheRecord | undefined {
  const filePath = cacheFilePath(props.identity);
  const result = v.safeParse(storedCacheSchema, readJsonFile(filePath));
  if (!result.success) {
    return undefined;
  }
  const parsed = result.output;

  const ttl = props.cacheTtlMs ?? defaultCacheTtlMs;
  if (Date.now() - parsed.resolvedAt > ttl) {
    return undefined;
  }

  const { config } = props.identity;
  if (
    parsed.region !== config.region ||
    parsed.stackName !== config.stackName ||
    (parsed.secretId ?? null) !== (config.secretId ?? null)
  ) {
    return undefined;
  }

  return { values: parsed.values };
}

/** Delete the cache file for an identity; a no-op when it does not exist. */
export function purgeCache(props: { readonly identity: CacheIdentity }): void {
  const filePath = cacheFilePath(props.identity);
  rmSync(filePath, { force: true });
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}
