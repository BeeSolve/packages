import * as v from "valibot";

export const dateSchema = v.pipe(
  v.string(),
  v.transform((value) => new Date(value)),
  v.date(),
);

export const expiresAtSchema = v.pipe(
  v.number(),
  v.transform((value) => new Date(value * 1000)),
  v.date(),
);
