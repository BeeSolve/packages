import type { Dimensions } from "./geometry";

export const defaultSizeBuckets: ReadonlyArray<number> = [500, 1000, 1500, 2000, 2500, 3000];
export const defaultMinSourceToBucketRatio = 1.5;

export interface SelectBucketProps {
  /** Dimensions after EXIF orientation. */
  source: Dimensions;
  /** `requiredScale` of the geometry. */
  requiredScale: number;
  sizeBuckets: ReadonlyArray<number>;
  minSourceToBucketRatio: number;
}

/**
 * Returns the smallest bucket (longest edge in pixels) whose uniformly scaled intermediate still
 * covers the required scale and is at least `minSourceToBucketRatio` times smaller than the
 * source. Returns `undefined` when the original should be used directly.
 */
export function selectBucket(props: SelectBucketProps): number | undefined {
  const longestEdge = Math.max(props.source.width, props.source.height);
  const candidates = props.sizeBuckets.filter(
    (bucket) =>
      bucket / longestEdge >= props.requiredScale &&
      bucket * props.minSourceToBucketRatio <= longestEdge,
  );
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}
