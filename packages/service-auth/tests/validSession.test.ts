import { describe, expect, it } from "bun:test";

import { toValidSession } from "../src/validSession.ts";

describe("toValidSession", () => {
  it("projects a non-impersonating session unchanged", () => {
    const result = toValidSession({
      userId: "user-123",
      sessionId: "session-id-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(result.impersonating).toBe(false);
    expect(result.userId).toBe("user-123");
    expect(result.sessionId).toBe("session-id-123");
    expect(result.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("swaps userId to the target and records the impersonator when impersonatedId is set", () => {
    const result = toValidSession({
      userId: "the-impersonator",
      sessionId: "session-id-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
      impersonatedId: "target-user",
    });

    expect(result.impersonating).toBe(true);
    if (!result.impersonating) throw new Error("expected impersonating session");
    expect(result.userId).toBe("target-user");
    expect(result.impersonatedBy).toBe("the-impersonator");
    expect(result.sessionId).toBe("session-id-123");
    expect(result.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  });
});
