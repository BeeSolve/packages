import { describe, expect, mock, test } from "bun:test";

import { BadRequestError } from "../src/errors.ts";
import { endImpersonation } from "../src/handlers/endImpersonation.ts";

const impersonationSession = {
  id: "imp-sid",
  sessionId: "logical-session-id",
  userId: "target-user",
  impersonatedBy: "operator-1",
  startedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

interface Deps {
  headers: Headers;
  requestBody: () => Promise<unknown>;
  sessions: {
    getOne: ReturnType<typeof mock>;
    createOne: ReturnType<typeof mock>;
    delete: ReturnType<typeof mock>;
  };
  events: { putEvents: ReturnType<typeof mock> };
}

function createDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    headers: new Headers({ cookie: "__Host-SID=imp-sid", accept: "application/json" }),
    requestBody: () => Promise.resolve({ redirectTo: "/admin" }),
    sessions: {
      getOne: mock(() => Promise.resolve(impersonationSession)),
      createOne: mock(() => Promise.resolve({ id: "new-sid", maxAge: 2_592_000 })),
      delete: mock(() => Promise.resolve()),
    },
    events: { putEvents: mock(() => Promise.resolve()) },
    ...overrides,
  };
}

describe("endImpersonation", () => {
  test("rejects with BadRequestError when the session is not an impersonation session", async () => {
    const deps = createDeps({
      sessions: {
        getOne: mock(() => Promise.resolve({ ...impersonationSession, impersonatedBy: undefined })),
        createOne: mock(() => Promise.resolve({ id: "new-sid", maxAge: 2_592_000 })),
        delete: mock(() => Promise.resolve()),
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

  test("JSON happy path returns 200 with redirectTo and swaps sessions", async () => {
    const deps = createDeps();
    const res = await endImpersonation(deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redirectTo).toBe("/admin");

    expect(deps.sessions.createOne).toHaveBeenCalledTimes(1);
    expect(deps.sessions.createOne.mock.calls[0]?.[0].userId).toBe("operator-1");

    expect(deps.sessions.delete).toHaveBeenCalledTimes(1);
    expect(deps.sessions.delete.mock.calls[0]?.[0]).toBe("imp-sid");
  });

  test("JSON happy path emits ImpersonationEnded with the correct user ids", async () => {
    const deps = createDeps();
    await endImpersonation(deps);

    expect(deps.events.putEvents).toHaveBeenCalledTimes(1);
    const event = deps.events.putEvents.mock.calls[0]?.[0];
    expect(event.type).toBe("ImpersonationEnded");
    expect(event.detail.currentUserId).toBe("operator-1");
    expect(event.detail.targetUserId).toBe("target-user");
    expect(typeof event.detail.endedAt).toBe("string");
  });

  test("redirect path returns 303 with Location and clears + sets cookies", async () => {
    const deps = createDeps({
      headers: new Headers({ cookie: "__Host-SID=imp-sid" }),
    });
    const res = await endImpersonation(deps);

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("imp-sid");
    expect(setCookie).toContain("new-sid");
  });
});
