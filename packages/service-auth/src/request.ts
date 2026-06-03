import * as v from "valibot";

import { BadRequestError } from "./errors.ts";

export function parseBody<TInput, TOutput>(props: {
  body: unknown;
  schema: v.BaseSchema<TInput, TOutput, v.BaseIssue<unknown>>;
}): TOutput {
  const result = v.safeParse(props.schema, props.body);
  if (!result.success) {
    console.error(v.flatten(result.issues));
    throw new BadRequestError("Error parsing request body.");
  }

  return result.output;
}
