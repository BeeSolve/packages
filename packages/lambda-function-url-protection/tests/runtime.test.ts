import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { protectFetch, protectHandler } from "../runtime";
import { originTokenEnvVar } from "../shared";

const token = "secret-token-value";

let originalToken: string | undefined;

beforeEach(() => {
  originalToken = process.env[originTokenEnvVar];
});

afterEach(() => {
  if (originalToken == null) {
    delete process.env[originTokenEnvVar];
    return;
  }
  process.env[originTokenEnvVar] = originalToken;
});

describe("protectFetch", () => {
  const inner = protectFetch(async () => new Response("ok", { status: 200 }));

  it("delegates to the inner handler when the header matches", async () => {
    process.env[originTokenEnvVar] = token;
    const response = await inner(
      new Request("https://lambda/", { headers: { "x-origin-token": token } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects with 403 and no-store when the header is missing", async () => {
    process.env[originTokenEnvVar] = token;
    const response = await inner(new Request("https://lambda/"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects with 403 when the token is wrong", async () => {
    process.env[originTokenEnvVar] = token;
    const response = await inner(
      new Request("https://lambda/", { headers: { "x-origin-token": "wrong" } }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects with 403 when the env var is unset", async () => {
    delete process.env[originTokenEnvVar];
    const response = await inner(
      new Request("https://lambda/", { headers: { "x-origin-token": token } }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects with 403 when the env var is an empty string", async () => {
    process.env[originTokenEnvVar] = "";
    const response = await inner(
      new Request("https://lambda/", { headers: { "x-origin-token": "" } }),
    );
    expect(response.status).toBe(403);
  });
});

describe("protectHandler", () => {
  const inner = protectHandler(async () => ({ statusCode: 200, body: "ok" }));
  const context = {};

  it("delegates when the lowercase header key matches", async () => {
    process.env[originTokenEnvVar] = token;
    const result = await inner({ headers: { "x-origin-token": token } }, context);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("ok");
  });

  it("delegates when the header key differs only by case", async () => {
    process.env[originTokenEnvVar] = token;
    const result = await inner({ headers: { "X-Origin-Token": token } }, context);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("ok");
  });

  it("rejects with 403 and no-store when the header is missing", async () => {
    process.env[originTokenEnvVar] = token;
    const result = await inner({ headers: {} }, context);
    expect(result.statusCode).toBe(403);
    expect("headers" in result ? result.headers?.["cache-control"] : undefined).toBe("no-store");
    expect(result.body).toBe("");
  });

  it("rejects with 403 when the token is wrong", async () => {
    process.env[originTokenEnvVar] = token;
    const result = await inner({ headers: { "x-origin-token": "wrong" } }, context);
    expect(result.statusCode).toBe(403);
  });

  it("rejects with 403 when the env var is unset", async () => {
    delete process.env[originTokenEnvVar];
    const result = await inner({ headers: { "x-origin-token": token } }, context);
    expect(result.statusCode).toBe(403);
  });

  it("rejects with 403 when the env var is an empty string", async () => {
    process.env[originTokenEnvVar] = "";
    const result = await inner({ headers: { "x-origin-token": "" } }, context);
    expect(result.statusCode).toBe(403);
  });
});
