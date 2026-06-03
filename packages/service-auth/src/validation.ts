import * as v from "valibot";

export const dateSchema = v.pipe(v.string(), v.isoTimestamp());

export const expiresAtSchema = v.pipe(
  v.number(),
  v.transform((value) => new Date(value * 1000).toISOString()),
  v.isoTimestamp(),
);
