import * as v from "valibot";

import { BadRequestError } from "./errors.ts";

export async function getBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return request.json();
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text).entries());
  }

  throw new BadRequestError(
    "Unsupported Content-Type. Expected application/json or application/x-www-form-urlencoded.",
  );
}

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
