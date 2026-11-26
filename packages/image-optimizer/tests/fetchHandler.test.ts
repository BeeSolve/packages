import { beforeAll, describe, expect, it } from "bun:test";

import { defaultMinSourceToBucketRatio, defaultSizeBuckets } from "../src/buckets";
import type { ImageOptimizerConfig } from "../src/config";
import { createFetchHandler, pathToKey } from "../src/fetchHandler";
import { createFakeSource, createFakeStore } from "./fakes";
import { createImage } from "./fixtures";

beforeAll(() => {
  Bun.Image.backend = "bun";
});

const config: ImageOptimizerConfig = {
  sourceBucket: "source",
  intermediateBucket: "intermediates",
  assetsPrefix: "assets",
  cacheTtlSeconds: 60,
  sizeBuckets: defaultSizeBuckets,
  maxSourceBytes: 10_000_000,
  maxPixels: 50_000_000,
  minSourceToBucketRatio: defaultMinSourceToBucketRatio,
};

async function handle(props: { path: string; method?: string; headers?: Record<string, string> }) {
  const bytes = await createImage({ width: 200, height: 100, format: "jpeg" });
  const fake = createFakeSource({
    "assets/photos/cat.jpg": { bytes, etag: '"e"', contentType: "image/jpeg" },
    "assets/my photos/cat 1.jpg": { bytes, etag: '"e"', contentType: "image/jpeg" },
    "secret/cat.jpg": { bytes, etag: '"e"', contentType: "image/jpeg" },
  });
  const handler = createFetchHandler({
    config,
    source: fake.source,
    store: createFakeStore().store,
  });
  return handler(
    new Request(`https://cdn.example.com${props.path}`, {
      method: props.method ?? "GET",
      headers: props.headers,
    }),
  );
}

describe("createFetchHandler", () => {
  it("serves an optimized image", async () => {
    const response = await handle({
      path: "/assets/photos/cat.jpg?w=100",
      headers: { accept: "image/webp" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("X-Image-Optimizer")).toBe("optimized");
  });

  it("decodes percent-encoded path segments", async () => {
    const response = await handle({ path: "/assets/my%20photos/cat%201.jpg" });

    expect(response.status).toBe(200);
  });

  it("returns 404 for a missing object", async () => {
    expect((await handle({ path: "/assets/photos/dog.jpg" })).status).toBe(404);
  });

  it("returns 404 outside the assets prefix, even for existing objects", async () => {
    expect((await handle({ path: "/secret/cat.jpg" })).status).toBe(404);
    expect((await handle({ path: "/other/photos/cat.jpg" })).status).toBe(404);
    expect((await handle({ path: "/assets/" })).status).toBe(404);
    expect((await handle({ path: "/" })).status).toBe(404);
  });

  it("returns 400 for invalid parameters with a readable body", async () => {
    const response = await handle({ path: "/assets/photos/cat.jpg?w=99999" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid image parameters");
  });

  it("returns 400 for unsupported parameters", async () => {
    expect((await handle({ path: "/assets/photos/cat.jpg?crop=faces" })).status).toBe(400);
    expect((await handle({ path: "/assets/photos/cat.jpg?fit=crop" })).status).toBe(400);
  });

  it("never serves traversal attempts", async () => {
    for (const path of [
      "/assets/%2e%2e/secret.jpg",
      "/assets/photos/%2E%2E/%2e%2e/x.jpg",
      "/assets/photos%2F..%2Fcat.jpg",
      "/assets//photos/cat.jpg",
      "/assets/%E0%A4%A.jpg",
    ]) {
      const response = await handle({ path });
      expect([400, 404]).toContain(response.status);
    }
  });

  it("returns 400 for encoded separators and malformed encoding", async () => {
    expect((await handle({ path: "/assets/photos%2F..%2Fcat.jpg" })).status).toBe(400);
    expect((await handle({ path: "/assets//photos/cat.jpg" })).status).toBe(400);
    expect((await handle({ path: "/assets/%E0%A4%A.jpg" })).status).toBe(400);
  });

  it("returns 405 for other methods", async () => {
    expect((await handle({ path: "/assets/photos/cat.jpg", method: "POST" })).status).toBe(405);
  });
});

describe("pathToKey", () => {
  it("rejects traversal, empty segments and encoded separators", () => {
    for (const pathname of [
      "/assets/../secret.jpg",
      "/assets/%2e%2e/secret.jpg",
      "/assets/a/./b.jpg",
      "/assets/a//b.jpg",
      "/assets/a%2Fb.jpg",
    ]) {
      expect(pathToKey({ pathname, assetsPrefix: "assets" })).toEqual({
        error: "Invalid path",
        status: 400,
      });
    }
  });

  it("decodes segments and keeps the prefix in the key", () => {
    expect(pathToKey({ pathname: "/assets/a%20b/c.jpg", assetsPrefix: "assets" })).toEqual({
      key: "assets/a b/c.jpg",
    });
  });

  it("supports nested and empty prefixes", () => {
    expect(pathToKey({ pathname: "/static/img/a.jpg", assetsPrefix: "static/img" })).toEqual({
      key: "static/img/a.jpg",
    });
    expect(pathToKey({ pathname: "/a/b.jpg", assetsPrefix: "" })).toEqual({ key: "a/b.jpg" });
  });

  it("does not match a prefix that is only a string prefix", () => {
    expect(pathToKey({ pathname: "/assetsx/a.jpg", assetsPrefix: "assets" })).toEqual({
      error: "Not Found",
      status: 404,
    });
  });
});
