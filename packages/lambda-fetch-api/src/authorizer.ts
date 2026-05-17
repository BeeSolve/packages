// Standard Schema V1 — https://standardschema.dev/
export interface StandardSchemaV1<Input = unknown, Output = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: StandardSchemaV1.Types<Input, Output> | undefined;
  };
}

export declare namespace StandardSchemaV1 {
  type InferOutput<T extends StandardSchemaV1> = NonNullable<
    T["~standard"]["types"]
  >["output"];
  type Result<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<Issue> };
  interface Issue {
    readonly message: string;
  }
  interface Types<Input = unknown, Output = unknown> {
    readonly input: Input;
    readonly output: Output;
  }
}

import { getAwsEvent } from "./store";

async function parseWithSchema<T extends StandardSchemaV1>(
  schema: T,
  value: unknown,
): Promise<StandardSchemaV1.InferOutput<T>> {
  const result = await schema["~standard"].validate(value);
  if (result.issues != null)
    throw new AuthorizerContextValidationError(
      result.issues.map((i) => i.message).join("; "),
    );
  return result.value as StandardSchemaV1.InferOutput<T>;
}

/**
 * Returns the Lambda authorizer payload for HTTP API v2 events.
 * Reads `event.requestContext.authorizer.lambda`.
 */
export function getAwsLambdaAuthorizerContext(): unknown;
export function getAwsLambdaAuthorizerContext<T extends StandardSchemaV1>(
  schema: T,
): Promise<StandardSchemaV1.InferOutput<T>>;
export function getAwsLambdaAuthorizerContext<T extends StandardSchemaV1>(
  schema?: T,
): unknown | Promise<StandardSchemaV1.InferOutput<T>> {
  const event = getAwsEvent();
  const payload = (event.requestContext as any)?.authorizer?.lambda;
  if (schema == null) return payload;
  return parseWithSchema(schema, payload);
}

/**
 * Returns the custom authorizer context for REST API v1 events.
 * Reads `event.requestContext.authorizer`.
 */
export function getAwsCustomAuthorizerContext(): unknown;
export function getAwsCustomAuthorizerContext<T extends StandardSchemaV1>(
  schema: T,
): Promise<StandardSchemaV1.InferOutput<T>>;
export function getAwsCustomAuthorizerContext<T extends StandardSchemaV1>(
  schema?: T,
): unknown | Promise<StandardSchemaV1.InferOutput<T>> {
  const event = getAwsEvent();
  const payload = (event.requestContext as any)?.authorizer;
  if (schema == null) return payload;
  return parseWithSchema(schema, payload);
}

export class AuthorizerContextValidationError extends Error {}
