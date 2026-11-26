import * as v from "valibot";

import { imageLimits } from "./limits";
import {
  canonicalizeQuery,
  fitModes,
  flipModes,
  outputFormats,
  queryDefaults,
  rotations,
} from "./query";

const dimension = v.pipe(
  v.string(),
  v.regex(/^\d+$/),
  v.transform(Number),
  v.integer(),
  v.minValue(1),
  v.maxValue(imageLimits.maxDimension),
);

const quality = v.pipe(
  v.string(),
  v.regex(/^\d+$/),
  v.transform(Number),
  v.integer(),
  v.minValue(imageLimits.minQuality),
  v.maxValue(imageLimits.maxQuality),
);

const pixelRatio = v.pipe(
  v.string(),
  v.regex(/^\d+(\.\d+)?$/),
  v.transform(Number),
  v.minValue(imageLimits.minDpr),
  v.maxValue(imageLimits.maxDpr),
);

const rotation = v.pipe(v.string(), v.transform(Number), v.picklist(rotations));

const placeholder = v.pipe(
  v.picklist(["0", "1"]),
  v.transform((value) => value === "1"),
);

const imageParamsSchema = v.object({
  w: v.optional(dimension),
  h: v.optional(dimension),
  dpr: v.optional(pixelRatio, String(queryDefaults.dpr)),
  fit: v.optional(v.picklist(fitModes), queryDefaults.fit),
  q: v.optional(quality, String(queryDefaults.q)),
  fm: v.optional(v.picklist(outputFormats)),
  rot: v.optional(rotation, String(queryDefaults.rot)),
  flip: v.optional(v.picklist(flipModes)),
  placeholder: v.optional(placeholder, queryDefaults.placeholder),
});

export type ImageParams = v.InferOutput<typeof imageParamsSchema>;

/**
 * Parses the query string of an image request. Throws an `Error` whose message is safe to
 * return in a 400 response.
 */
export function parseParams(query: string): ImageParams {
  const canonical = canonicalizeQuery(query);
  if ("error" in canonical) throw new Error(canonical.error);

  const result = v.safeParse(imageParamsSchema, toRecord(canonical.query));
  if (!result.success) {
    throw new Error(`Invalid image parameters: ${v.summarize(result.issues)}`);
  }
  return result.output;
}

function toRecord(query: string): Record<string, string> {
  const record: Record<string, string> = {};
  if (query === "") return record;
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    record[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return record;
}
