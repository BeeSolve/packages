import type { FingerprintInputs } from "./cache.ts";
import { computeFingerprint } from "./cache.ts";
import type { SecurityRunner } from "./keychain.ts";
import { addGenericPassword, deleteGenericPassword, findGenericPassword } from "./keychain.ts";

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(props: {
    readonly key: string;
    readonly value: string;
    readonly trusted: boolean;
  }): Promise<void>;
  purge(): Promise<void>;
}

/** Build the keychain service string shared with the on-disk cache identity. */
export function keychainService(props: {
  readonly projectKey: string;
  readonly namespace: string;
  readonly config: FingerprintInputs;
}): string {
  const fingerprint = computeFingerprint(props.config);
  return `aws-env-resolver:${props.projectKey}:${props.namespace}:${fingerprint}`;
}

/** macOS keychain-backed secret store; one generic-password item per secret env var. */
export class KeychainSecretStore implements SecretStore {
  private readonly service: string;
  private readonly secretKeys: ReadonlyArray<string>;
  private readonly runner?: SecurityRunner;
  private readonly platform?: NodeJS.Platform;

  constructor(props: {
    readonly service: string;
    readonly secretKeys: ReadonlyArray<string>;
    readonly runner?: SecurityRunner;
    readonly platform?: NodeJS.Platform;
  }) {
    this.service = props.service;
    this.secretKeys = props.secretKeys;
    this.runner = props.runner;
    this.platform = props.platform;
  }

  get(key: string): Promise<string | undefined> {
    return findGenericPassword({
      account: key,
      service: this.service,
      runner: this.runner,
      platform: this.platform,
    });
  }

  set(props: {
    readonly key: string;
    readonly value: string;
    readonly trusted: boolean;
  }): Promise<void> {
    return addGenericPassword({
      account: props.key,
      service: this.service,
      secret: props.value,
      trusted: props.trusted,
      runner: this.runner,
      platform: this.platform,
    });
  }

  async purge(): Promise<void> {
    for (const key of this.secretKeys) {
      await deleteGenericPassword({
        account: key,
        service: this.service,
        runner: this.runner,
        platform: this.platform,
      });
    }
  }
}

/** Non-macOS fallback: no secure cache, so reads always miss and writes are discarded. */
export class NoopSecretStore implements SecretStore {
  get(_key: string): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  set(_props: {
    readonly key: string;
    readonly value: string;
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
  readonly namespace: string;
  readonly config: FingerprintInputs;
  readonly secretKeys: ReadonlyArray<string>;
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
      namespace: props.namespace,
      config: props.config,
    }),
    secretKeys: props.secretKeys,
    runner: props.runner,
    platform,
  });
}
