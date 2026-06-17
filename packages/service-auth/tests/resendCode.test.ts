import { describe, expect, mock, test } from "bun:test";

import {
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
  TokenDoesNotExistError,
  TokenThrottledError,
} from "@beesolve/action-tokens/model";

import { BadRequestError } from "../src/errors.ts";
import { resendCode } from "../src/handlers/resendCode.ts";

const mockTokenResult = {
  owner: "new-tok",
  action: "signInRequest",
  value: "654321",
  remainingUses: 3,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

const validPeekResult = {
  owner: "old-token",
  action: "signInRequest",
  value: "123456",
  remainingUses: 2,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  data: { emailAddress: "user@example.com", accountId: "acc-123" },
};

function createDeps(overrides = {}) {
  return {
    actionTokens: {
      peek: mock(() => Promise.resolve(validPeekResult)),
      drain: mock(() => Promise.resolve()),
      createNewWithThrottling: mock(() => Promise.resolve(mockTokenResult)),
    },
    events: { putEvents: mock(() => Promise.resolve()) },
    requestBody: () => Promise.resolve({ token: "old-token" }),
    otpExpirySeconds: 600,
    resendCooldownSeconds: 60,
    drainOnResend: true,
    baseUri: "https://example.com",
    cookies: { lang: "en" },
    acceptLanguage: "en-US",
    requestOrigin: "https://example.com",
    ...overrides,
  };
}

// oxlint-disable-next-line typescript/no-explicit-any
function mockCalls(fn: unknown): Array<Array<any>> {
  return (fn as { mock: { calls: Array<Array<unknown>> } }).mock.calls;
}

describe("resendCode", () => {
  test("happy path: returns new token, referenceCode, canResendAt, expiresAt", async () => {
    const deps = createDeps();
    const res = await resendCode(deps as Parameters<typeof resendCode>[0]);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("referenceCode");
    expect(body).toHaveProperty("canResendAt");
    expect(body).toHaveProperty("expiresAt");
    expect(body.token).not.toBe("old-token");
  });

  test("drains old token when drainOnResend is true", async () => {
    const deps = createDeps();
    await resendCode(deps as Parameters<typeof resendCode>[0]);

    expect(deps.actionTokens.drain).toHaveBeenCalledWith({
      owner: "old-token",
      action: "signInRequest",
    });
  });

  test("does not drain old token when drainOnResend is false", async () => {
    const deps = createDeps({ drainOnResend: false });
    await resendCode(deps as Parameters<typeof resendCode>[0]);

    expect(deps.actionTokens.drain).not.toHaveBeenCalled();
  });

  test("passes accountId from token data to event", async () => {
    const deps = createDeps();
    await resendCode(deps as Parameters<typeof resendCode>[0]);

    const eventCall = mockCalls(deps.events.putEvents)[0]?.[0];
    expect(eventCall.detail.accountId).toBe("acc-123");
  });

  test("stores accountId in new token data", async () => {
    const deps = createDeps();
    await resendCode(deps as Parameters<typeof resendCode>[0]);

    const call = mockCalls(deps.actionTokens.createNewWithThrottling)[0]?.[0];
    expect(call.data).toEqual({ emailAddress: "user@example.com", accountId: "acc-123" });
  });

  test("throws BadRequestError when token not found", async () => {
    const deps = createDeps({
      actionTokens: {
        peek: mock(() => Promise.reject(new TokenDoesNotExistError("not found"))),
        drain: mock(() => Promise.resolve()),
        createNewWithThrottling: mock(() => Promise.resolve(mockTokenResult)),
      },
    });

    expect(resendCode(deps as Parameters<typeof resendCode>[0])).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  test("throws BadRequestError when token expired", async () => {
    const deps = createDeps({
      actionTokens: {
        peek: mock(() => Promise.reject(new ExpiredTokenError("expired"))),
        drain: mock(() => Promise.resolve()),
        createNewWithThrottling: mock(() => Promise.resolve(mockTokenResult)),
      },
    });

    expect(resendCode(deps as Parameters<typeof resendCode>[0])).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  test("throws BadRequestError when token used up", async () => {
    const deps = createDeps({
      actionTokens: {
        peek: mock(() => Promise.reject(new TokenAlreadyUsedUpError("used up"))),
        drain: mock(() => Promise.resolve()),
        createNewWithThrottling: mock(() => Promise.resolve(mockTokenResult)),
      },
    });

    expect(resendCode(deps as Parameters<typeof resendCode>[0])).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  test("throws TokenThrottledError when throttled", async () => {
    const deps = createDeps({
      actionTokens: {
        peek: mock(() => Promise.resolve(validPeekResult)),
        drain: mock(() => Promise.resolve()),
        createNewWithThrottling: mock(() => Promise.reject(new TokenThrottledError("throttled"))),
      },
    });

    expect(resendCode(deps as Parameters<typeof resendCode>[0])).rejects.toBeInstanceOf(
      TokenThrottledError,
    );
  });

  test("throws BadRequestError for empty token", async () => {
    const deps = createDeps({ requestBody: () => Promise.resolve({ token: "" }) });
    expect(resendCode(deps as Parameters<typeof resendCode>[0])).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  test("throws BadRequestError when token data has no emailAddress", async () => {
    const deps = createDeps({
      actionTokens: {
        peek: mock(() => Promise.resolve({ ...validPeekResult, data: { foo: "bar" } })),
        drain: mock(() => Promise.resolve()),
        createNewWithThrottling: mock(() => Promise.resolve(mockTokenResult)),
      },
    });

    expect(resendCode(deps as Parameters<typeof resendCode>[0])).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});
