import * as v from "valibot";

import type { FingerprintInputs } from "./cache.ts";
import { computeFingerprint } from "./cache.ts";
import type { SecurityRunner } from "./keychain.ts";
import { addGenericPassword, deleteGenericPassword, findGenericPassword } from "./keychain.ts";

export interface SecretStore {
  get(): Promise<Record<string, string> | undefined>;
  set(props: { readonly values: Record<string, string>; readonly trusted: boolean }): Promise<void>;
  purge(): Promise<void>;
}

const secretsAccount = "secrets";

const storedSecretsSchema = v.record(v.string(), v.string());

/** Build the keychain service string shared with the on-disk cache identity. */
export function keychainService(props: {
  readonly projectKey: string;
  readonly stage: string;
  readonly config: FingerprintInputs;
}): string {
  const fingerprint = computeFingerprint(props.config);
  return `aws-env-resolver:${props.projectKey}:${props.stage}:${fingerprint}`;
}

/**
 * macOS keychain-backed secret store: one generic-password item per identity holding every secret
 * as a JSON object, so a read costs one keychain access (and one prompt) regardless of how many
 * secrets there are.
 */
export class KeychainSecretStore implements SecretStore {
  private readonly service: string;
  private readonly runner?: SecurityRunner;
  private readonly platform?: NodeJS.Platform;

  constructor(props: {
    readonly service: string;
    readonly runner?: SecurityRunner;
    readonly platform?: NodeJS.Platform;
  }) {
    this.service = props.service;
    this.runner = props.runner;
    this.platform = props.platform;
  }

  async get(): Promise<Record<string, string> | undefined> {
    const raw = await findGenericPassword({
      account: secretsAccount,
      service: this.service,
      runner: this.runner,
      platform: this.platform,
    });
    if (raw == null) {
      return undefined;
    }
    const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), storedSecretsSchema), raw);
    return parsed.success ? parsed.output : undefined;
  }

  set(props: {
    readonly values: Record<string, string>;
    readonly trusted: boolean;
  }): Promise<void> {
    return addGenericPassword({
      account: secretsAccount,
      service: this.service,
      secret: toAsciiJson(props.values),
      trusted: props.trusted,
      runner: this.runner,
      platform: this.platform,
    });
  }

  purge(): Promise<void> {
    return deleteGenericPassword({
      account: secretsAccount,
      service: this.service,
      runner: this.runner,
      platform: this.platform,
    });
  }
}

function toAsciiJson(values: Record<string, string>): string {
  return JSON.stringify(values).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Non-macOS fallback: no secure cache, so reads always miss and writes are discarded. */
export class NoopSecretStore implements SecretStore {
  get(): Promise<Record<string, string> | undefined> {
    return Promise.resolve(undefined);
  }

  set(_props: {
    readonly values: Record<string, string>;
    readonly trusted: boolean;
  }): Promise<void> {
    return Promise.resolve();
  }

  purge(): Promise<void> {
    return Promise.resolve();
  }
}

export function createSecretStore(props: {
  readonly projectKey: string;
  readonly stage: string;
  readonly config: FingerprintInputs;
  readonly platform?: NodeJS.Platform;
  readonly runner?: SecurityRunner;
}): SecretStore {
  const platform = props.platform ?? process.platform;
  if (platform !== "darwin") {
    return new NoopSecretStore();
  }
  return new KeychainSecretStore({
    service: keychainService({
      projectKey: props.projectKey,
      stage: props.stage,
      config: props.config,
    }),
    runner: props.runner,
    platform,
  });
}
