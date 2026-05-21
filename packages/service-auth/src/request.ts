import * as v from "valibot";
import { BadRequestError } from "./errors.ts";

export function parseBody<TInput, TOutput>(props: {
  body: any;
  schema: v.BaseSchema<TInput, TOutput, v.BaseIssue<unknown>>;
}): TOutput {
  const result = v.safeParse(props.schema, props.body);
  if (!result.success) {
    const issues = v.flatten(result.issues);

    throw new BadRequestError({
      message: `Error parsing request body.`,
      details: issues.nested,
    });
  }

  return result.output;
}
