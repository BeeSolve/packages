import { describe, expect, mock, test } from "bun:test";

import { BadRequestError } from "../src/errors.ts";
import { endImpersonation } from "../src/handlers/endImpersonation.ts";

const impersonationSession = {
  id: "imp-sid",
  sessionId: "logical-session-id",
  userId: "the-impersonator",
  impersonatedId: "target-user",
  startedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

interface Deps {
  headers: Headers;
  requestBody: () => Promise<unknown>;
  sessions: {
    getOne: ReturnType<typeof mock>;
    stopImpersonating: ReturnType<typeof mock>;
  };
  events: { putEvents: ReturnType<typeof mock> };
}

function createDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    headers: new Headers({ cookie: "__Host-SID=imp-sid", accept: "application/json" }),
    requestBody: () => Promise.resolve({ redirectTo: "/admin" }),
    sessions: {
      getOne: mock(() => Promise.resolve(impersonationSession)),
      stopImpersonating: mock(() => Promise.resolve()),
    },
    events: { putEvents: mock(() => Promise.resolve()) },
    ...overrides,
  };
}

describe("endImpersonation", () => {
  test("rejects with BadRequestError when the session is not an impersonation session", async () => {
    const deps = createDeps({
      sessions: {
        getOne: mock(() => Promise.resolve({ ...impersonationSession, impersonatedId: undefined })),
        stopImpersonating: mock(() => Promise.resolve()),
      },
    });

    expect(endImpersonation(deps)).rejects.toBeInstanceOf(BadRequestError);
  });

  test("rejects with BadRequestError when the cookie has no __Host-SID", async () => {
    const deps = createDeps({
      headers: new Headers({ cookie: "other=value", accept: "application/json" }),
    });

    expect(endImpersonation(deps)).rejects.toBeInstanceOf(BadRequestError);
  });

  test("JSON happy path returns 200 with redirectTo and stops impersonating on the same session", async () => {
    const deps = createDeps();
    const res = await endImpersonation(deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redirectTo).toBe("/admin");

    expect(deps.sessions.stopImpersonating).toHaveBeenCalledTimes(1);
    expect(deps.sessions.stopImpersonating.mock.calls[0]?.[0]).toBe("imp-sid");

    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  test("JSON happy path emits ImpersonationEnded with the correct user ids", async () => {
    const deps = createDeps();
    await endImpersonation(deps);

    expect(deps.events.putEvents).toHaveBeenCalledTimes(1);
    const event = deps.events.putEvents.mock.calls[0]?.[0];
    expect(event.type).toBe("ImpersonationEnded");
    expect(event.detail.currentUserId).toBe("the-impersonator");
    expect(event.detail.targetUserId).toBe("target-user");
    expect(typeof event.detail.endedAt).toBe("string");
  });

  test("redirect path returns 303 with Location and no cookie change", async () => {
    const deps = createDeps({
      headers: new Headers({ cookie: "__Host-SID=imp-sid" }),
    });
    const res = await endImpersonation(deps);

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});
