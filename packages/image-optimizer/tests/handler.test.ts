import { describe, expect, it } from "bun:test";

const streamingMarker = Symbol.for("aws.lambda.runtime.handler.streaming");

describe("handler", () => {
  async function importHandler() {
    Object.assign(globalThis, {
      awslambda: {
        streamifyResponse: (fn: object) => Object.assign(fn, { [streamingMarker]: "response" }),
        HttpResponseStream: { from: (stream: unknown) => stream },
      },
    });
    Object.assign(process.env, {
      SOURCE_BUCKET: "source",
      INTERMEDIATE_BUCKET: "intermediates",
      ASSETS_PREFIX: "assets",
      CACHE_TTL_SECONDS: "60",
      SIZE_BUCKETS: "500,1000",
      MAX_SOURCE_BYTES: "1000000",
      MAX_PIXELS: "1000000",
      MIN_SOURCE_TO_BUCKET_RATIO: "1.5",
    });
    return (await import("../src/handler")).handler;
  }

  it("is still a streaming handler after the keep-active wrapper", async () => {
    const handler = await importHandler();

    expect(Reflect.get(handler, streamingMarker)).toBe("response");
  });

  it("returns on a keep-active ping without reading the request or touching S3", async () => {
    const handler = await importHandler();
    const writes: Array<unknown> = [];
    const responseStream = { write: (chunk: unknown) => writes.push(chunk), end: () => undefined };

    const result = Reflect.apply(handler, undefined, [
      { $$keepActivePing$$: true },
      responseStream,
      {},
    ]);

    expect(result).toBeUndefined();
    expect(writes).toEqual([]);
  });
});
