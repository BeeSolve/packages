import { describe, expect, it, mock } from "bun:test";

import { authorize } from "../src/authorize.ts";
import { Sessions } from "../src/session.ts";

interface SessionItemOverrides {
  readonly id?: string;
  readonly userId?: string;
  readonly impersonatedBy?: string;
  readonly expiresAtSeconds?: number;
  readonly createdAt?: string;
}

function makeSessionItem(overrides: SessionItemOverrides = {}) {
  const now = new Date();
  const createdAt = overrides.createdAt ?? now.toISOString();

  return {
    id: overrides.id ?? "session-id-123",
    sessionId: "logical-session-id",
    userId: overrides.userId ?? "target-user",
    impersonatedBy: overrides.impersonatedBy,
    startedAt: new Date(now.getTime() - 86_400_000).toISOString(),
    createdAt,
    expiresAt: overrides.expiresAtSeconds ?? Math.round((now.getTime() + 2_592_000_000) / 1000),
  };
}

function createSessions(item: ReturnType<typeof makeSessionItem>) {
  const dynamo = { send: mock(() => Promise.resolve({ Item: item })) };
  const sessions = new Sessions({
    dynamo,
    tableName: "sessions",
    userIdIndexName: "userIdGsi",
    refreshDrift: 15_000,
    refreshInterval: 3_600_000,
  });

  return { dynamo, sessions };
}

describe("authorize", () => {
  it("returns invalid when the cookie header is missing", async () => {
    const { sessions } = createSessions(makeSessionItem());

    const result = await authorize({ sessions, cookieHeader: null });

    expect(result.type).toBe("invalid");
  });

  it("returns invalid when the cookie has no __Host-SID entry", async () => {
    const { sessions } = createSessions(makeSessionItem());

    const result = await authorize({ sessions, cookieHeader: "other=value" });

    expect(result.type).toBe("invalid");
  });

  it("returns invalid with a clear-cookie param when the session does not exist", async () => {
    const dynamo = { send: mock(() => Promise.resolve({ Item: undefined })) };
    const sessions = new Sessions({
      dynamo,
      tableName: "sessions",
      userIdIndexName: "userIdGsi",
    });

    const result = await authorize({ sessions, cookieHeader: "__Host-SID=missing-sid" });

    expect(result.type).toBe("invalid");
    expect(result.setCookiesParams).toEqual([{ sid: "missing-sid", maxAge: -1 }]);
  });

  it("returns expired when the session is past its expiry", async () => {
    const item = makeSessionItem({
      expiresAtSeconds: Math.round((Date.now() - 60_000) / 1000),
    });
    const { sessions } = createSessions(item);

    const result = await authorize({ sessions, cookieHeader: "__Host-SID=session-id-123" });

    expect(result.type).toBe("expired");
    if (result.type !== "expired") throw new Error("expected expired result");
    expect(result.expiredSession.userId).toBe("target-user");
  });

  it("builds a non-impersonating valid session for a normal session", async () => {
    const item = makeSessionItem({ userId: "target-user" });
    const { sessions } = createSessions(item);

    const result = await authorize({ sessions, cookieHeader: "__Host-SID=session-id-123" });

    expect(result.type).toBe("valid");
    if (result.type !== "valid") throw new Error("expected valid result");
    expect(result.validSession.impersonating).toBe(false);
    expect(result.validSession.userId).toBe("target-user");
    expect(result.validSession.sessionId).toBe("session-id-123");
  });

  it("builds an impersonating valid session when impersonatedBy is present", async () => {
    const item = makeSessionItem({ userId: "target-user", impersonatedBy: "operator-1" });
    const { sessions } = createSessions(item);

    const result = await authorize({ sessions, cookieHeader: "__Host-SID=session-id-123" });

    expect(result.type).toBe("valid");
    if (result.type !== "valid") throw new Error("expected valid result");
    expect(result.validSession.impersonating).toBe(true);
    if (!result.validSession.impersonating) throw new Error("expected impersonating session");
    expect(result.validSession.impersonatedBy).toBe("operator-1");
    expect(result.validSession.userId).toBe("target-user");
  });
});
