import { describe, expect, mock, test } from "bun:test";

import { TokenInvalidError } from "@beesolve/action-tokens/model";

import { signInComplete } from "../src/handlers/signInComplete.ts";

const mockTokenResult = {
  owner: "tok",
  action: "signInRequest",
  value: "123456",
  remainingUses: 3,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  data: { emailAddress: "user@example.com" },
};

const mockAccount = {
  id: "acc-123",
  username: "user@example.com",
  type: "email" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockSession = {
  id: "sid-123",
  sessionId: "sess-123",
  userId: "acc-123",
  startedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
  updatedAt: new Date().toISOString(),
  data: {},
  maxAge: 2_592_000,
};

function createDeps(overrides: Record<string, unknown> = {}) {
  return {
    actionTokens: {
      use: mock(() => Promise.resolve(mockTokenResult)),
    },
    sessions: { createOne: mock(() => Promise.resolve(mockSession)) },
    accounts: {
      getOne: mock(() => Promise.resolve(mockAccount)),
      createNew: mock(() => Promise.resolve(mockAccount)),
    },
    events: { putEvents: mock(() => Promise.resolve()) },
    headers: new Headers(),
    requestBody: () => Promise.resolve({ code: "123456", token: "tok" }),
    allowSignUp: false,
    dataToken: undefined,
    ...overrides,
  };
}

// oxlint-disable-next-line typescript/no-explicit-any
function mockCalls(fn: { mock: { calls: Array<Array<any>> } }): Array<Array<any>> {
  return fn.mock.calls;
}

describe("signInComplete", () => {
  test("known email creates a session and sets cookie", async () => {
    const deps = createDeps();
    const res = await signInComplete(deps);

    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toContain("sid-123");
    expect(mockCalls(deps.sessions.createOne).length).toBe(1);

    const emittedTypes = mockCalls(deps.events.putEvents).map((call) => call[0]?.type);
    expect(emittedTypes).not.toContain("UnsuccessfulAuth");
  });

  test("known email with json accept returns 200 with cookie", async () => {
    const deps = createDeps({ headers: new Headers({ accept: "application/json" }) });
    const res = await signInComplete(deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redirectTo).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("sid-123");
  });

  test("unknown email with allowSignUp=false emits emailNotRegistered and does not leak", async () => {
    const deps = createDeps({
      accounts: {
        getOne: mock(() => Promise.reject(new Error("not found"))),
        createNew: mock(() => Promise.resolve(mockAccount)),
      },
    });
    const res = await signInComplete(deps);

    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mockCalls(deps.sessions.createOne).length).toBe(0);

    const event = mockCalls(deps.events.putEvents)[0]?.[0];
    expect(event.type).toBe("UnsuccessfulAuth");
    expect(event.detail.code).toBe("emailNotRegistered");
    expect(event.detail.emailAddress).toBe("user@example.com");
  });

  test("unknown email with allowSignUp=false and json accept returns 200 without cookie", async () => {
    const deps = createDeps({
      allowSignUp: false,
      headers: new Headers({ accept: "application/json" }),
      accounts: {
        getOne: mock(() => Promise.reject(new Error("not found"))),
        createNew: mock(() => Promise.resolve(mockAccount)),
      },
    });
    const res = await signInComplete(deps);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(body).not.toContain("Email not registered");
  });

  test("unknown email with allowSignUp=true creates account, session, and emits EmailAddressVerified", async () => {
    const deps = createDeps({
      allowSignUp: true,
      accounts: {
        getOne: mock(() => Promise.reject(new Error("not found"))),
        createNew: mock(() => Promise.resolve(mockAccount)),
      },
    });
    const res = await signInComplete(deps);

    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toContain("sid-123");
    expect(mockCalls(deps.accounts.createNew).length).toBe(1);
    expect(mockCalls(deps.sessions.createOne).length).toBe(1);

    const emittedTypes = mockCalls(deps.events.putEvents).map((call) => call[0]?.type);
    expect(emittedTypes).toContain("EmailAddressVerified");
  });

  test("invalid token emits invalidToken and rethrows", async () => {
    const deps = createDeps({
      actionTokens: {
        use: mock(() => Promise.reject(new TokenInvalidError("Invalid code."))),
      },
    });

    expect(signInComplete(deps)).rejects.toBeInstanceOf(TokenInvalidError);

    await signInComplete(deps).catch(() => {});
    const event = mockCalls(deps.events.putEvents)[0]?.[0];
    expect(event.type).toBe("UnsuccessfulAuth");
    expect(event.detail.code).toBe("invalidToken");
  });
});
