import { describe, expect, it, mock } from "bun:test";

import { Sessions } from "../src/session.ts";

function createMockDynamo() {
  return { send: mock(() => Promise.resolve({})) };
}

function makeSession(overrides: { createdAt?: string; expiresAt?: string } = {}) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setUTCSeconds(expiresAt.getUTCSeconds() + 2_592_000);

  return {
    id: "session-id-123",
    sessionId: "logical-session-id",
    userId: "user-123",
    startedAt: new Date(now.getTime() - 86_400_000).toISOString(),
    createdAt: overrides.createdAt ?? now.toISOString(),
    expiresAt: overrides.expiresAt ?? expiresAt.toISOString(),
  };
}

describe("Sessions.refresh", () => {
  describe("drift guard", () => {
    it("skips rotation when session age is less than refreshDrift", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
        refreshDrift: 15_000,
        refreshInterval: 3_600_000,
      });

      const session = makeSession({ createdAt: new Date().toISOString() });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession).toBe(session);
      expect(dynamo.send).not.toHaveBeenCalled();
    });

    it("skips rotation even when refreshInterval is 0 if age < drift", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
        refreshDrift: 15_000,
        refreshInterval: 0,
      });

      const session = makeSession({ createdAt: new Date().toISOString() });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession).toBe(session);
      expect(dynamo.send).not.toHaveBeenCalled();
    });
  });

  describe("refresh interval guard", () => {
    it("skips rotation when session age is between drift and refreshInterval", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
        refreshDrift: 15_000,
        refreshInterval: 3_600_000, // 1 hour
      });

      // Session created 5 minutes ago — past drift (15s) but within interval (1h)
      const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
      const session = makeSession({ createdAt });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession).toBe(session);
      expect(dynamo.send).not.toHaveBeenCalled();
    });

    it("returns recalculated maxAge when skipping rotation", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
        defaultMaxAge: 2_592_000,
        refreshDrift: 15_000,
        refreshInterval: 3_600_000,
      });

      const now = Date.now();
      const createdAt = new Date(now - 60_000).toISOString(); // 1 minute ago
      const expiresAt = new Date(now + 1_000_000_000).toISOString(); // far future
      const session = makeSession({ createdAt, expiresAt });

      const result = await sessions.refresh({ session, data: {} });

      // maxAge should be capped at defaultMaxAge since expiresAt is far in the future
      expect(result.maxAge).toBeLessThanOrEqual(2_592_000);
      expect(result.maxAge).toBeGreaterThan(0);
    });
  });

  describe("rotation", () => {
    it("rotates when session age exceeds refreshInterval", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
        refreshDrift: 15_000,
        refreshInterval: 3_600_000, // 1 hour
      });

      // Session created 2 hours ago
      const createdAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const session = makeSession({ createdAt });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession.id).not.toBe(session.id);
      expect(result.newSession.sessionId).toBe(session.sessionId);
      expect(result.newSession.userId).toBe(session.userId);
      expect(dynamo.send).toHaveBeenCalledTimes(1);
    });

    it("rotates when session age equals refreshInterval", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
        refreshDrift: 15_000,
        refreshInterval: 60_000, // 1 minute
      });

      // Session created exactly 1 minute ago
      const createdAt = new Date(Date.now() - 60_000).toISOString();
      const session = makeSession({ createdAt });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession.id).not.toBe(session.id);
      expect(dynamo.send).toHaveBeenCalledTimes(1);
    });

    it("uses default refreshInterval of 1 hour when not specified", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
      });

      // Session created 30 minutes ago — within default 1h interval
      const createdAt = new Date(Date.now() - 30 * 60_000).toISOString();
      const session = makeSession({ createdAt });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession).toBe(session);
      expect(dynamo.send).not.toHaveBeenCalled();
    });

    it("rotates with default refreshInterval when session is older than 1 hour", async () => {
      const dynamo = createMockDynamo();
      const sessions = new Sessions({
        dynamo,
        tableName: "sessions",
        userIdIndexName: "userIdGsi",
      });

      // Session created 2 hours ago — past default 1h interval
      const createdAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const session = makeSession({ createdAt });

      const result = await sessions.refresh({ session, data: {} });

      expect(result.newSession.id).not.toBe(session.id);
      expect(dynamo.send).toHaveBeenCalledTimes(1);
    });
  });
});
