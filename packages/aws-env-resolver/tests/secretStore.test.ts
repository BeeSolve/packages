import { describe, expect, it } from "bun:test";

import type { FingerprintInputs } from "../src/cache.ts";
import type { SecurityRunResult, SecurityRunner } from "../src/keychain.ts";
import {
  createSecretStore,
  keychainService,
  KeychainSecretStore,
  NoopSecretStore,
} from "../src/secretStore.ts";

interface FakeRunner {
  readonly runner: SecurityRunner;
  readonly calls: Array<ReadonlyArray<string>>;
}

function makeFakeRunner(
  respond: (args: ReadonlyArray<string>) => SecurityRunResult = () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  }),
): FakeRunner {
  const calls: Array<ReadonlyArray<string>> = [];
  const runner: SecurityRunner = (args) => {
    calls.push(args);
    return Promise.resolve(respond(args));
  };
  return { runner, calls };
}

const config: FingerprintInputs = {
  region: "eu-central-1",
  stackName: "example-stack",
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

function makeStore(props: {
  readonly runner: SecurityRunner;
  readonly secretKeys?: ReadonlyArray<string>;
  readonly platform?: NodeJS.Platform;
  readonly namespaceConfig?: FingerprintInputs;
}): KeychainSecretStore {
  return new KeychainSecretStore({
    service: keychainService({
      projectKey: "example-app",
      namespace: "staging",
      config: props.namespaceConfig ?? config,
    }),
    secretKeys: props.secretKeys ?? ["API_KEY", "HMAC_SECRET"],
    runner: props.runner,
    platform: props.platform ?? "darwin",
  });
}

describe("KeychainSecretStore.set", () => {
  it("builds interactive add-generic-password argv with an empty trust list", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner });

    await store.set({ key: "API_KEY", value: "super-secret-value", trusted: false });

    const service = keychainService({ projectKey: "example-app", namespace: "staging", config });
    expect(fake.calls[0]).toEqual([
      "add-generic-password",
      "-a",
      "API_KEY",
      "-s",
      service,
      "-w",
      "super-secret-value",
      "-U",
      "-T",
      "",
    ]);
  });

  it("builds trusted add-generic-password argv with /usr/bin/security", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner });

    await store.set({ key: "API_KEY", value: "super-secret-value", trusted: true });

    const argv = fake.calls[0] ?? [];
    expect(argv).toContain("-T");
    expect(argv[argv.indexOf("-T") + 1]).toBe("/usr/bin/security");
  });

  it("never includes the secret value in a thrown error", async () => {
    const secret = "super-secret-value";
    const fake = makeFakeRunner(() => ({
      exitCode: 1,
      stdout: "",
      stderr: "some keychain failure",
    }));
    const store = makeStore({ runner: fake.runner });

    const error = await captureError(() =>
      store.set({ key: "API_KEY", value: secret, trusted: false }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain("API_KEY");
  });
});

describe("KeychainSecretStore.get", () => {
  it("returns the -w output trimmed of a trailing newline", async () => {
    const fake = makeFakeRunner(() => ({
      exitCode: 0,
      stdout: "resolved-secret\n",
      stderr: "",
    }));
    const store = makeStore({ runner: fake.runner });

    const value = await store.get("API_KEY");

    expect(value).toBe("resolved-secret");
    expect(fake.calls[0]).toEqual([
      "find-generic-password",
      "-a",
      "API_KEY",
      "-s",
      keychainService({ projectKey: "example-app", namespace: "staging", config }),
      "-w",
    ]);
  });

  it("returns undefined when the item is not found", async () => {
    const fake = makeFakeRunner(() => ({
      exitCode: 44,
      stdout: "",
      stderr: "The specified item could not be found in the keychain.",
    }));
    const store = makeStore({ runner: fake.runner });

    expect(await store.get("API_KEY")).toBeUndefined();
  });
});

describe("KeychainSecretStore.purge", () => {
  it("issues a delete-generic-password for each known secret key", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner, secretKeys: ["API_KEY", "HMAC_SECRET"] });

    await store.purge();

    const accounts = fake.calls.map((args) => args[args.indexOf("-a") + 1]);
    expect(fake.calls.every((args) => args[0] === "delete-generic-password")).toBe(true);
    expect(accounts).toEqual(["API_KEY", "HMAC_SECRET"]);
  });
});

describe("keychain service identity", () => {
  it("includes the fingerprint and differs when the stack name differs", () => {
    const service = keychainService({ projectKey: "example-app", namespace: "staging", config });
    const otherStack = keychainService({
      projectKey: "example-app",
      namespace: "staging",
      config: { ...config, stackName: "other-stack" },
    });

    expect(service.startsWith("aws-env-resolver:example-app:staging:")).toBe(true);
    expect(service).not.toBe(otherStack);
  });
});

describe("platform guard", () => {
  it("throws when used on a non-darwin platform", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner, platform: "linux" });

    const error = await captureError(() => store.get("API_KEY"));

    expect(error.message).toMatch(/macOS-only/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("NoopSecretStore", () => {
  it("get returns undefined and set/purge resolve without a runner", async () => {
    const store = new NoopSecretStore();

    expect(await store.get("API_KEY")).toBeUndefined();
    expect(await store.set({ key: "API_KEY", value: "x", trusted: false })).toBeUndefined();
    expect(await store.purge()).toBeUndefined();
  });
});

describe("createSecretStore", () => {
  it("returns a KeychainSecretStore on darwin", () => {
    const fake = makeFakeRunner();
    const store = createSecretStore({
      projectKey: "example-app",
      namespace: "staging",
      config,
      secretKeys: ["API_KEY"],
      platform: "darwin",
      runner: fake.runner,
    });

    expect(store).toBeInstanceOf(KeychainSecretStore);
  });

  it("returns a NoopSecretStore on a non-darwin platform", () => {
    const store = createSecretStore({
      projectKey: "example-app",
      namespace: "staging",
      config,
      secretKeys: ["API_KEY"],
      platform: "linux",
    });

    expect(store).toBeInstanceOf(NoopSecretStore);
  });
});
