import * as v from "valibot";

import { environmentNames } from "./environment";

const positiveInteger = v.pipe(
  v.string(),
  v.transform(Number),
  v.number(),
  v.integer(),
  v.minValue(1),
);

const sizeBuckets = v.pipe(
  v.string(),
  v.transform((value) => value.split(",").map(Number)),
  v.array(v.pipe(v.number(), v.integer(), v.minValue(1))),
  v.minLength(1),
  v.check(
    (buckets) =>
      buckets.every((bucket, index) => index === 0 || bucket > (buckets[index - 1] ?? 0)),
    "must be ascending and unique",
  ),
);

const environmentSchema = v.object({
  [environmentNames.sourceBucket]: v.pipe(v.string(), v.minLength(1)),
  [environmentNames.intermediateBucket]: v.pipe(v.string(), v.minLength(1)),
  [environmentNames.assetsPrefix]: v.string(),
  [environmentNames.cacheTtlSeconds]: positiveInteger,
  [environmentNames.sizeBuckets]: sizeBuckets,
  [environmentNames.maxSourceBytes]: positiveInteger,
  [environmentNames.maxPixels]: positiveInteger,
  [environmentNames.minSourceToBucketRatio]: v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.minValue(1),
  ),
});

export interface ImageOptimizerConfig {
  sourceBucket: string;
  intermediateBucket: string;
  assetsPrefix: string;
  cacheTtlSeconds: number;
  sizeBuckets: ReadonlyArray<number>;
  maxSourceBytes: number;
  maxPixels: number;
  minSourceToBucketRatio: number;
}

/** Parses the environment of the image Lambda. Throws with all invalid variables listed. */
export function parseConfig(env: Record<string, string | undefined>): ImageOptimizerConfig {
  const result = v.safeParse(environmentSchema, env);
  if (!result.success) {
    throw new Error(`Invalid image optimizer environment: ${v.summarize(result.issues)}`);
  }
  const parsed = result.output;
  return {
    sourceBucket: parsed.SOURCE_BUCKET,
    intermediateBucket: parsed.INTERMEDIATE_BUCKET,
    assetsPrefix: parsed.ASSETS_PREFIX,
    cacheTtlSeconds: parsed.CACHE_TTL_SECONDS,
    sizeBuckets: parsed.SIZE_BUCKETS,
    maxSourceBytes: parsed.MAX_SOURCE_BYTES,
    maxPixels: parsed.MAX_PIXELS,
    minSourceToBucketRatio: parsed.MIN_SOURCE_TO_BUCKET_RATIO,
  };
}
