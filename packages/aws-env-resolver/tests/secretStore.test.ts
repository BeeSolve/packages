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
  readonly platform?: NodeJS.Platform;
  readonly stageConfig?: FingerprintInputs;
}): KeychainSecretStore {
  return new KeychainSecretStore({
    service: keychainService({
      projectKey: "example-app",
      stage: "staging",
      config: props.stageConfig ?? config,
    }),
    runner: props.runner,
    platform: props.platform ?? "darwin",
  });
}

describe("KeychainSecretStore.set", () => {
  it("stores every secret as one JSON item with an empty trust list", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner });

    await store.set({
      values: { API_KEY: "super-secret-value", HMAC_SECRET: "hmac" },
      trusted: false,
    });

    const service = keychainService({ projectKey: "example-app", stage: "staging", config });
    expect(fake.calls).toEqual([
      [
        "add-generic-password",
        "-a",
        "secrets",
        "-s",
        service,
        "-w",
        '{"API_KEY":"super-secret-value","HMAC_SECRET":"hmac"}',
        "-U",
        "-T",
        "",
      ],
    ]);
  });

  it("builds trusted add-generic-password argv with /usr/bin/security", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner });

    await store.set({ values: { API_KEY: "super-secret-value" }, trusted: true });

    const argv = fake.calls[0] ?? [];
    expect(argv).toContain("-T");
    expect(argv[argv.indexOf("-T") + 1]).toBe("/usr/bin/security");
  });

  it("escapes non-ASCII characters so the stored value stays printable", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner });

    await store.set({ values: { NAME: "žába" }, trusted: false });

    const argv = fake.calls[0] ?? [];
    const stored = argv[argv.indexOf("-w") + 1] ?? "";
    expect(stored).toBe('{"NAME":"\\u017e\\u00e1ba"}');
    expect(JSON.parse(stored)).toEqual({ NAME: "žába" });
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
      store.set({ values: { API_KEY: secret }, trusted: false }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(secret);
  });
});

describe("KeychainSecretStore.get", () => {
  it("parses the stored JSON item", async () => {
    const fake = makeFakeRunner(() => ({
      exitCode: 0,
      stdout: '{"API_KEY":"resolved-secret"}\n',
      stderr: "",
    }));
    const store = makeStore({ runner: fake.runner });

    const values = await store.get();

    expect(values).toEqual({ API_KEY: "resolved-secret" });
    expect(fake.calls).toEqual([
      [
        "find-generic-password",
        "-a",
        "secrets",
        "-s",
        keychainService({ projectKey: "example-app", stage: "staging", config }),
        "-w",
      ],
    ]);
  });

  it("returns undefined when the item is not found", async () => {
    const fake = makeFakeRunner(() => ({
      exitCode: 44,
      stdout: "",
      stderr: "The specified item could not be found in the keychain.",
    }));
    const store = makeStore({ runner: fake.runner });

    expect(await store.get()).toBeUndefined();
  });

  it("returns undefined when the stored value is not a JSON object of strings", async () => {
    const fake = makeFakeRunner(() => ({ exitCode: 0, stdout: "not-json\n", stderr: "" }));
    const store = makeStore({ runner: fake.runner });

    expect(await store.get()).toBeUndefined();
  });
});

describe("KeychainSecretStore.purge", () => {
  it("deletes the single secrets item", async () => {
    const fake = makeFakeRunner();
    const store = makeStore({ runner: fake.runner });

    await store.purge();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.[0]).toBe("delete-generic-password");
    expect(fake.calls[0]?.[fake.calls[0].indexOf("-a") + 1]).toBe("secrets");
  });
});

describe("keychain service identity", () => {
  it("includes the fingerprint and differs when the stack name differs", () => {
    const service = keychainService({ projectKey: "example-app", stage: "staging", config });
    const otherStack = keychainService({
      projectKey: "example-app",
      stage: "staging",
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

    const error = await captureError(() => store.get());

    expect(error.message).toMatch(/macOS-only/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("NoopSecretStore", () => {
  it("get returns undefined and set/purge resolve without a runner", async () => {
    const store = new NoopSecretStore();

    expect(await store.get()).toBeUndefined();
    expect(await store.set({ values: { API_KEY: "x" }, trusted: false })).toBeUndefined();
    expect(await store.purge()).toBeUndefined();
  });
});

describe("createSecretStore", () => {
  it("returns a KeychainSecretStore on darwin", () => {
    const fake = makeFakeRunner();
    const store = createSecretStore({
      projectKey: "example-app",
      stage: "staging",
      config,
      platform: "darwin",
      runner: fake.runner,
    });

    expect(store).toBeInstanceOf(KeychainSecretStore);
  });

  it("returns a NoopSecretStore on a non-darwin platform", () => {
    const store = createSecretStore({
      projectKey: "example-app",
      stage: "staging",
      config,
      platform: "linux",
    });

    expect(store).toBeInstanceOf(NoopSecretStore);
  });
});
