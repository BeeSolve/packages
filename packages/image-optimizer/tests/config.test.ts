import { describe, expect, it } from "bun:test";

import { parseConfig } from "../src/config";

const valid = {
  SOURCE_BUCKET: "source",
  INTERMEDIATE_BUCKET: "intermediates",
  ASSETS_PREFIX: "assets",
  CACHE_TTL_SECONDS: "31536000",
  SIZE_BUCKETS: "500,1000,1500",
  MAX_SOURCE_BYTES: "52428800",
  MAX_PIXELS: "50000000",
  MIN_SOURCE_TO_BUCKET_RATIO: "1.5",
};

describe("parseConfig", () => {
  it("parses a valid environment", () => {
    expect(parseConfig(valid)).toEqual({
      sourceBucket: "source",
      intermediateBucket: "intermediates",
      assetsPrefix: "assets",
      cacheTtlSeconds: 31536000,
      sizeBuckets: [500, 1000, 1500],
      maxSourceBytes: 52428800,
      maxPixels: 50000000,
      minSourceToBucketRatio: 1.5,
    });
  });

  it("allows an empty assets prefix", () => {
    expect(parseConfig({ ...valid, ASSETS_PREFIX: "" }).assetsPrefix).toBe("");
  });

  it("rejects a missing variable and names it", () => {
    const { SOURCE_BUCKET: _removed, ...rest } = valid;

    expect(() => parseConfig(rest)).toThrow("SOURCE_BUCKET");
  });

  it("rejects invalid numbers", () => {
    expect(() => parseConfig({ ...valid, CACHE_TTL_SECONDS: "0" })).toThrow("CACHE_TTL_SECONDS");
    expect(() => parseConfig({ ...valid, MAX_PIXELS: "abc" })).toThrow("MAX_PIXELS");
    expect(() => parseConfig({ ...valid, MIN_SOURCE_TO_BUCKET_RATIO: "0.5" })).toThrow(
      "MIN_SOURCE_TO_BUCKET_RATIO",
    );
  });

  it("rejects size buckets that are not ascending and unique", () => {
    expect(() => parseConfig({ ...valid, SIZE_BUCKETS: "1000,500" })).toThrow("SIZE_BUCKETS");
    expect(() => parseConfig({ ...valid, SIZE_BUCKETS: "500,500" })).toThrow("SIZE_BUCKETS");
    expect(() => parseConfig({ ...valid, SIZE_BUCKETS: "500,x" })).toThrow("SIZE_BUCKETS");
    expect(() => parseConfig({ ...valid, SIZE_BUCKETS: "" })).toThrow("SIZE_BUCKETS");
  });
});
