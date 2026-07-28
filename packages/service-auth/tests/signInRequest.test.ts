import { describe, expect, mock, test } from "bun:test";

import { TokenThrottledError } from "@beesolve/action-tokens/model";

import { signInRequest } from "../src/handlers/signInRequest.ts";

const mockTokenResult = {
  owner: "tok",
  action: "signInRequest",
  value: "123456",
  remainingUses: 3,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

const mockAccount = {
  id: "acc-123",
  username: "user@example.com",
  type: "email" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function createDeps(overrides = {}) {
  return {
    actionTokens: { createNewWithThrottling: mock(() => Promise.resolve(mockTokenResult)) },
    accounts: { getOne: mock(() => Promise.resolve(mockAccount)) },
    events: { putEvents: mock(() => Promise.resolve()) },
    baseUri: "https://example.com",
    requestBody: () => Promise.resolve({ emailAddress: "User@Example.COM" }),
    cookies: { lang: "en" },
    acceptLanguage: "en-US",
    requestOrigin: "https://example.com",
    otpExpirySeconds: 600,
    resendCooldownSeconds: 60,
    ...overrides,
  };
}

// oxlint-disable-next-line typescript/no-explicit-any
function mockCalls(fn: { mock: { calls: Array<Array<any>> } }): Array<Array<any>> {
  return fn.mock.calls;
}

describe("signInRequest", () => {
  test("returns token, referenceCode, canResendAt, expiresAt", async () => {
    const deps = createDeps();
    const res = await signInRequest(deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("referenceCode");
    expect(body).toHaveProperty("canResendAt");
    expect(body).toHaveProperty("expiresAt");
    expect(typeof body.token).toBe("string");
    expect(typeof body.referenceCode).toBe("string");
  });

  test("normalizes email to lowercase and passes to throttle", async () => {
    const deps = createDeps();
    await signInRequest(deps);

    const call = mockCalls(deps.actionTokens.createNewWithThrottling)[0]?.[0];
    expect(call.throttle).toEqual({ id: "user@example.com", windowSeconds: 60 });
    expect(call.data).toEqual({ emailAddress: "user@example.com", accountId: "acc-123" });
  });

  test("emits event with referenceCode and accountId", async () => {
    const deps = createDeps();
    await signInRequest(deps);

    const eventCall = mockCalls(deps.events.putEvents)[0]?.[0];
    expect(eventCall.type).toBe("EmailCodeAuth");
    expect(eventCall.detail.referenceCode).toBeDefined();
    expect(eventCall.detail.accountId).toBe("acc-123");
    expect(eventCall.detail.emailAddress).toBe("user@example.com");
  });

  test("sets accountId to null when account not found", async () => {
    const deps = createDeps({
      accounts: { getOne: mock(() => Promise.reject(new Error("not found"))) },
    });
    await signInRequest(deps);

    const call = mockCalls(deps.actionTokens.createNewWithThrottling)[0]?.[0];
    expect(call.data).toEqual({ emailAddress: "user@example.com", accountId: null });

    const eventCall = mockCalls(deps.events.putEvents)[0]?.[0];
    expect(eventCall.detail.accountId).toBeNull();
  });

  test("throws TokenThrottledError when throttled", async () => {
    const deps = createDeps({
      actionTokens: {
        createNewWithThrottling: mock(() =>
          Promise.reject(new TokenThrottledError("Too many requests. Try again later.")),
        ),
      },
    });

    expect(signInRequest(deps)).rejects.toBeInstanceOf(TokenThrottledError);
  });

  test("throws BadRequestError for invalid email", async () => {
    const deps = createDeps({ requestBody: () => Promise.resolve({ emailAddress: "not-email" }) });
    expect(signInRequest(deps)).rejects.toThrow();
  });
});
