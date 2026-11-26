import { describe, expect, it } from "bun:test";

import { defaultMinSourceToBucketRatio, defaultSizeBuckets, selectBucket } from "../src/buckets";
import { computeGeometry } from "../src/geometry";
import type { Dimensions } from "../src/geometry";
import { parseParams } from "../src/params";

function bucketFor(props: { source: Dimensions; query: string }): number | undefined {
  const geometry = computeGeometry({ source: props.source, params: parseParams(props.query) });
  return selectBucket({
    source: props.source,
    requiredScale: geometry.requiredScale,
    sizeBuckets: defaultSizeBuckets,
    minSourceToBucketRatio: defaultMinSourceToBucketRatio,
  });
}

describe("selectBucket", () => {
  const square = { width: 1800, height: 1800 };

  it("selects the next boundary above the requested size", () => {
    expect(bucketFor({ source: square, query: "w=250&h=280" })).toBe(500);
    expect(bucketFor({ source: square, query: "w=501&h=501" })).toBe(1000);
  });

  it("selects the boundary itself when it covers the size exactly", () => {
    expect(bucketFor({ source: square, query: "w=500&h=500" })).toBe(500);
  });

  it("uses the original when the next boundary is not smaller enough than the source", () => {
    expect(bucketFor({ source: square, query: "w=1700&h=1700" })).toBeUndefined();
  });

  it("uses the original for small sources", () => {
    expect(
      bucketFor({ source: { width: 400, height: 400 }, query: "w=250&h=250" }),
    ).toBeUndefined();
  });

  it("covers both axes for a skewed size", () => {
    expect(
      bucketFor({ source: { width: 1800, height: 900 }, query: "w=300&h=300&fit=scale" }),
    ).toBe(1000);
  });

  it("uses the original for enlarged output", () => {
    expect(bucketFor({ source: square, query: "w=3000" })).toBeUndefined();
  });

  it("uses the original when the size needs the whole source", () => {
    expect(bucketFor({ source: square, query: "" })).toBeUndefined();
  });

  it("depends on the longest edge of the rotated source", () => {
    const portrait = { width: 2000, height: 4000 };
    expect(bucketFor({ source: portrait, query: "w=200" })).toBe(500);
    expect(bucketFor({ source: portrait, query: "w=200&rot=90" })).toBe(500);
  });

  it("does not depend on the order of the buckets", () => {
    const geometry = computeGeometry({ source: square, params: parseParams("w=250") });
    const bucket = selectBucket({
      source: square,
      requiredScale: geometry.requiredScale,
      sizeBuckets: [3000, 500, 1000],
      minSourceToBucketRatio: 1.5,
    });
    expect(bucket).toBe(500);
  });

  it("respects a custom minimum ratio", () => {
    const geometry = computeGeometry({
      source: { width: 400, height: 400 },
      params: parseParams("w=250"),
    });
    expect(
      selectBucket({
        source: { width: 400, height: 400 },
        requiredScale: geometry.requiredScale,
        sizeBuckets: [300, 500],
        minSourceToBucketRatio: 1,
      }),
    ).toBe(300);
  });
});
