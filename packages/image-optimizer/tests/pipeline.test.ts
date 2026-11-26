import { beforeAll, describe, expect, it, spyOn } from "bun:test";

import { defaultMinSourceToBucketRatio, defaultSizeBuckets } from "../src/buckets";
import { parseParams } from "../src/params";
import { outcomeHeader, processImage } from "../src/pipeline";
import type { PipelineConfig } from "../src/pipeline";
import { createFakeSource, createFakeStore } from "./fakes";
import type { FakeFile } from "./fakes";
import { createImage, createPixelPng, decodePng, gifBytes, pixelAt, svgBytes } from "./fixtures";

beforeAll(() => {
  Bun.Image.backend = "bun";
});

const config: PipelineConfig = {
  cacheTtlSeconds: 3600,
  sizeBuckets: defaultSizeBuckets,
  maxSourceBytes: 10_000_000,
  maxPixels: 50_000_000,
  minSourceToBucketRatio: defaultMinSourceToBucketRatio,
};

function file(props: { bytes: Uint8Array; contentType: string; etag?: string }): FakeFile {
  return { bytes: props.bytes, contentType: props.contentType, etag: props.etag ?? '"etag-1"' };
}

interface RunProps {
  files: Record<string, FakeFile>;
  query?: string;
  accept?: string;
  key?: string;
  settings?: Partial<PipelineConfig>;
}

function setup(files: Record<string, FakeFile>) {
  return { fake: createFakeSource(files), fakeStore: createFakeStore() };
}

async function run(props: RunProps) {
  const { fake, fakeStore } = setup(props.files);
  const response = await call({ fake, fakeStore, ...props });
  return { response, fake, fakeStore };
}

async function call(props: {
  fake: ReturnType<typeof createFakeSource>;
  fakeStore: ReturnType<typeof createFakeStore>;
  query?: string;
  accept?: string;
  key?: string;
  settings?: Partial<PipelineConfig>;
}): Promise<Response> {
  return processImage({
    source: props.fake.source,
    store: props.fakeStore.store,
    key: props.key ?? "photo",
    params: parseParams(props.query ?? ""),
    accept: props.accept,
    config: { ...config, ...props.settings },
  });
}

async function dimensionsOf(response: Response): Promise<{ width: number; height: number }> {
  const metadata = await new Bun.Image(new Uint8Array(await response.arrayBuffer())).metadata();
  return { width: metadata.width, height: metadata.height };
}

async function formatOf(response: Response): Promise<string> {
  return (await new Bun.Image(new Uint8Array(await response.arrayBuffer())).metadata()).format;
}

describe("processImage", () => {
  it("returns 404 for a missing key without the outcome header", async () => {
    const { response } = await run({ files: {} });

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Image-Optimizer")).toBeNull();
  });

  it("returns WebP when the browser accepts it", async () => {
    const bytes = await createImage({ width: 200, height: 100, format: "jpeg" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/jpeg" }) },
      accept: "image/webp",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(await formatOf(response)).toBe("webp");
  });

  it("keeps the original format otherwise", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const bytes = await createImage({ width: 120, height: 60, format });
      const { response } = await run({
        files: { photo: file({ bytes, contentType: `image/${format}` }) },
        accept: "*/*",
      });

      expect(await formatOf(response)).toBe(format);
    }
  });

  it("keeps the original format without an Accept header", async () => {
    const bytes = await createImage({ width: 120, height: 60, format: "jpeg" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/jpeg" }) },
    });

    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("lets fm override the negotiated format", async () => {
    const bytes = await createImage({ width: 120, height: 60, format: "jpeg" });
    const files = { photo: file({ bytes, contentType: "image/jpeg" }) };

    const png = await run({ files, query: "fm=png", accept: "image/webp" });
    expect(await formatOf(png.response)).toBe("png");
    expect(png.response.headers.get("Content-Type")).toBe("image/png");

    const jpg = await run({ files, query: "fm=jpg", accept: "image/webp" });
    expect(jpg.response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("resizes with the requested geometry", async () => {
    const bytes = await createImage({ width: 200, height: 100, format: "png" });
    const files = { photo: file({ bytes, contentType: "image/png" }) };

    expect(await dimensionsOf((await run({ files, query: "w=100" })).response)).toEqual({
      width: 100,
      height: 50,
    });
    expect(
      await dimensionsOf((await run({ files, query: "w=300&h=300&fit=max" })).response),
    ).toEqual({
      width: 200,
      height: 100,
    });
    expect(
      await dimensionsOf((await run({ files, query: "w=30&h=30&fit=scale" })).response),
    ).toEqual({
      width: 30,
      height: 30,
    });
    expect(await dimensionsOf((await run({ files, query: "" })).response)).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("rotates before resizing", async () => {
    const bytes = await createImage({ width: 200, height: 100, format: "png" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/png" }) },
      query: "rot=90&w=50",
    });

    expect(await dimensionsOf(response)).toEqual({ width: 50, height: 100 });
  });

  it("rotates clockwise and flips as imgix does", async () => {
    const bytes = createPixelPng({
      width: 4,
      height: 2,
      pixel: ({ x, y }) => [x * 60, y * 100, 0],
    });
    const files = { photo: file({ bytes, contentType: "image/png" }) };
    const decode = async (query: string) =>
      decodePng(
        new Uint8Array(
          await (await run({ files, query: `fm=png&${query}` })).response.arrayBuffer(),
        ),
      );

    const original = await decode("");
    expect(pixelAt({ pixels: original, x: 0, y: 0 })).toEqual([0, 0, 0]);
    expect(pixelAt({ pixels: original, x: 3, y: 0 })).toEqual([180, 0, 0]);

    const flipH = await decode("flip=h");
    expect(pixelAt({ pixels: flipH, x: 0, y: 0 })).toEqual([180, 0, 0]);
    expect(pixelAt({ pixels: flipH, x: 0, y: 1 })).toEqual([180, 100, 0]);

    const flipV = await decode("flip=v");
    expect(pixelAt({ pixels: flipV, x: 0, y: 0 })).toEqual([0, 100, 0]);

    const flipBoth = await decode("flip=hv");
    expect(pixelAt({ pixels: flipBoth, x: 0, y: 0 })).toEqual([180, 100, 0]);

    const rotated = await decode("rot=90");
    expect(rotated.width).toBe(2);
    expect(rotated.height).toBe(4);
    expect(pixelAt({ pixels: rotated, x: 0, y: 0 })).toEqual([0, 100, 0]);
    expect(pixelAt({ pixels: rotated, x: 1, y: 0 })).toEqual([0, 0, 0]);
  });

  it("applies quality to lossy formats", async () => {
    const bytes = await createImage({ width: 400, height: 300, format: "png" });
    const files = { photo: file({ bytes, contentType: "image/png" }) };
    const low = await (await run({ files, query: "fm=jpg&q=10" })).response.arrayBuffer();
    const high = await (await run({ files, query: "fm=jpg&q=95" })).response.arrayBuffer();

    expect(low.byteLength).toBeLessThan(high.byteLength);
  });

  it("returns a placeholder data URL as text", async () => {
    const bytes = await createImage({ width: 400, height: 300, format: "jpeg" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/jpeg" }) },
      query: "placeholder=1",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("X-Image-Optimizer")).toBe("placeholder");
    expect(await response.text()).toStartWith("data:image/");
  });

  it("sets caching and security headers", async () => {
    const bytes = await createImage({ width: 120, height: 60, format: "jpeg" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/jpeg" }) },
    });

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Image-Optimizer")).toBe("optimized");
  });
});

describe("passthrough", () => {
  it("returns a GIF unchanged and marks it", async () => {
    const { response, fake } = await run({
      files: { photo: file({ bytes: gifBytes, contentType: "image/gif" }) },
      query: "w=100&fm=webp",
      accept: "image/webp",
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(gifBytes);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(response.headers.get("X-Image-Optimizer")).toBe(
      "passthrough; reason=unsupported-format; format=gif",
    );
    expect(fake.stats.stream).toBe(1);
    expect(fake.stats.read).toBe(0);
  });

  it("uses the content type of the sniffed format, not the stored one", async () => {
    const { response } = await run({
      files: { photo: file({ bytes: gifBytes, contentType: "image/jpeg" }) },
    });

    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(response.headers.get("X-Image-Optimizer")).toBe(
      "passthrough; reason=unsupported-format; format=gif",
    );
  });

  it("passes an animated WebP through unchanged", async () => {
    const animatedWebp = animatedWebpHeader();
    const { response } = await run({
      files: { photo: file({ bytes: animatedWebp, contentType: "application/octet-stream" }) },
      query: "w=100&fm=jpg",
      accept: "image/webp",
    });

    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
      Array.from(animatedWebp),
    );
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("X-Image-Optimizer")).toBe(
      "passthrough; reason=unsupported-format; format=animated-webp",
    );
  });

  it("still processes a still WebP with an extended header", async () => {
    const bytes = await createImage({ width: 120, height: 60, format: "webp" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/webp" }) },
      query: "w=60",
    });

    expect(response.headers.get("X-Image-Optimizer")).toBe("optimized");
  });

  it("returns an SVG unchanged", async () => {
    const { response } = await run({
      files: { photo: file({ bytes: svgBytes, contentType: "image/svg+xml" }) },
      query: "w=100",
    });

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(svgBytes);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("X-Image-Optimizer")).toBe(
      "passthrough; reason=unsupported-format; format=svg",
    );
  });

  it("returns unknown content unchanged", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 not an image");
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "application/pdf" }) },
    });

    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("X-Image-Optimizer")).toBe(
      "passthrough; reason=unsupported-format; format=unknown",
    );
  });

  it("passes through large non-images regardless of the source size limit", async () => {
    const { response } = await run({
      files: { photo: file({ bytes: gifBytes, contentType: "image/gif" }) },
      settings: { maxSourceBytes: 10 },
    });

    expect(response.status).toBe(200);
  });
});

describe("limits", () => {
  it("rejects sources larger than maxSourceBytes", async () => {
    const bytes = await createImage({ width: 300, height: 200, format: "jpeg" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/jpeg" }) },
      settings: { maxSourceBytes: 1000 },
    });

    expect(response.status).toBe(422);
    expect(response.headers.get("X-Image-Optimizer")).toBeNull();
  });

  it("rejects sources with more pixels than maxPixels", async () => {
    const bytes = await createImage({ width: 300, height: 200, format: "png" });
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/png" }) },
      settings: { maxPixels: 10_000 },
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("pixels");
  });

  it("rejects images that cannot be decoded", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 1, 2, 3]);
    const { response } = await run({
      files: { photo: file({ bytes, contentType: "image/png" }) },
    });

    expect(response.status).toBe(422);
  });
});

describe("size buckets", () => {
  it("creates one intermediate and reuses it for other sizes", async () => {
    const bytes = await createImage({ width: 1800, height: 1200, format: "jpeg" });
    const { fake, fakeStore } = setup({ photo: file({ bytes, contentType: "image/jpeg" }) });

    const first = await call({ fake, fakeStore, query: "w=250" });
    expect(await dimensionsOf(first)).toEqual({ width: 250, height: 167 });
    expect(fake.stats.read).toBe(1);
    expect(fakeStore.stats.put).toBe(1);
    expect(Object.keys(fakeStore.items)).toEqual(["v1/photo/etag-1/500"]);

    const readsAfterFirst = fake.stats.read;
    const second = await call({ fake, fakeStore, query: "w=260" });
    expect(await dimensionsOf(second)).toEqual({ width: 260, height: 173 });
    const third = await call({ fake, fakeStore, query: "w=300&h=100&fit=max" });
    expect(third.status).toBe(200);

    expect(fake.stats.read).toBe(readsAfterFirst);
    expect(fakeStore.stats.put).toBe(1);
    expect(fakeStore.stats.get).toBe(3);
  });

  it("only reads the header range of the original when the intermediate exists", async () => {
    const bytes = await createImage({ width: 1800, height: 1200, format: "jpeg" });
    const { fake, fakeStore } = setup({ photo: file({ bytes, contentType: "image/jpeg" }) });
    await call({ fake, fakeStore, query: "w=250" });
    const rangeBytesBefore = fake.stats.rangeBytes;

    await call({ fake, fakeStore, query: "w=270" });

    expect(fake.stats.rangeBytes - rangeBytesBefore).toBeLessThanOrEqual(16 * 1024);
  });

  it("produces the same output with and without an existing intermediate", async () => {
    const bytes = await createImage({ width: 1800, height: 1200, format: "jpeg" });
    const files = { photo: file({ bytes, contentType: "image/jpeg" }) };
    const { fake, fakeStore } = setup(files);

    const cold = new Uint8Array(
      await (await call({ fake, fakeStore, query: "w=250" })).arrayBuffer(),
    );
    const warm = new Uint8Array(
      await (await call({ fake, fakeStore, query: "w=250" })).arrayBuffer(),
    );

    expect(fake.stats.read).toBe(1);
    expect(warm).toEqual(cold);
  });

  it("uses a new intermediate when the ETag changes", async () => {
    const bytes = await createImage({ width: 1800, height: 1200, format: "jpeg" });
    const { fake, fakeStore } = setup({ photo: file({ bytes, contentType: "image/jpeg" }) });
    await call({ fake, fakeStore, query: "w=250" });

    fake.files.photo = file({ bytes, contentType: "image/jpeg", etag: '"etag-2"' });
    await call({ fake, fakeStore, query: "w=250" });

    expect(Object.keys(fakeStore.items).sort()).toEqual([
      "v1/photo/etag-1/500",
      "v1/photo/etag-2/500",
    ]);
    expect(fake.stats.read).toBe(2);
  });

  it("uses the original when no bucket applies", async () => {
    const bytes = await createImage({ width: 600, height: 400, format: "jpeg" });
    const { fake, fakeStore } = setup({ photo: file({ bytes, contentType: "image/jpeg" }) });

    await call({ fake, fakeStore, query: "w=300" });

    expect(fakeStore.stats.put).toBe(0);
    expect(fake.stats.read).toBe(1);
  });

  it("still serves the image when storing the intermediate fails", async () => {
    const bytes = await createImage({ width: 1800, height: 1200, format: "jpeg" });
    const { fake, fakeStore } = setup({ photo: file({ bytes, contentType: "image/jpeg" }) });
    const failing = {
      get: (key: string) => fakeStore.store.get(key),
      put: async () => {
        throw new Error("denied");
      },
    };

    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    const response = await processImage({
      source: fake.source,
      store: failing,
      key: "photo",
      params: parseParams("w=250"),
      accept: undefined,
      config,
    });

    expect(response.status).toBe(200);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it("keeps the placeholder cheap by shrinking the target", async () => {
    const bytes = await createImage({ width: 1800, height: 1200, format: "jpeg" });
    const { fake, fakeStore } = setup({ photo: file({ bytes, contentType: "image/jpeg" }) });

    const response = await call({ fake, fakeStore, query: "placeholder=1&w=1000" });

    expect(response.headers.get("X-Image-Optimizer")).toBe("placeholder");
    expect(Object.keys(fakeStore.items)).toEqual(["v1/photo/etag-1/500"]);
  });
});

describe("outcomeHeader", () => {
  it("builds the header values", () => {
    expect(outcomeHeader({ kind: "optimized" })).toBe("optimized");
    expect(outcomeHeader({ kind: "placeholder" })).toBe("placeholder");
    expect(outcomeHeader({ kind: "passthrough", format: "gif" })).toBe(
      "passthrough; reason=unsupported-format; format=gif",
    );
  });

  it("strips unsafe characters from the format", () => {
    expect(outcomeHeader({ kind: "passthrough", format: "gi\r\nf; x" })).toBe(
      "passthrough; reason=unsupported-format; format=gifx",
    );
    expect(outcomeHeader({ kind: "passthrough", format: "animated-webp" })).toBe(
      "passthrough; reason=unsupported-format; format=animated-webp",
    );
  });
});

function animatedWebpHeader(): Uint8Array {
  const bytes = new Uint8Array(64);
  const write = (offset: number, text: string) =>
    Array.from(text).forEach((character, index) => {
      bytes[offset + index] = character.charCodeAt(0);
    });
  write(0, "RIFF");
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  write(8, "WEBP");
  write(12, "VP8X");
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes[20] = 0x12;
  bytes[24] = 159;
  bytes[27] = 119;
  write(30, "ANIM");
  return bytes;
}
