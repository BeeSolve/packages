import type { StandardSchemaV1 } from "@standard-schema/spec";
export type { StandardSchemaV1 } from "@standard-schema/spec";

import { getAwsEvent } from "./store";

function hasAuthorizer(
  requestContext: unknown,
): requestContext is { authorizer: Record<string, unknown> } {
  return (
    typeof requestContext === "object" &&
    requestContext !== null &&
    "authorizer" in requestContext &&
    typeof (requestContext as Record<string, unknown>).authorizer === "object"
  );
}

function hasLambdaAuthorizer(
  requestContext: unknown,
): requestContext is { authorizer: { lambda: unknown } } {
  if (!hasAuthorizer(requestContext)) return false;
  return "lambda" in requestContext.authorizer;
}

// oxlint-disable-next-line beesolve/prefer-props-object
async function parseWithSchema<T extends StandardSchemaV1>(
  schema: T,
  value: unknown,
): Promise<StandardSchemaV1.InferOutput<T>> {
  const result = await schema["~standard"].validate(value);
  if (result.issues != null)
    throw new AuthorizerContextValidationError(result.issues.map((i) => i.message).join("; "));
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
  const payload = hasLambdaAuthorizer(event.requestContext)
    ? event.requestContext.authorizer.lambda
    : undefined;
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
  const payload = hasAuthorizer(event.requestContext) ? event.requestContext.authorizer : undefined;
  if (schema == null) return payload;
  return parseWithSchema(schema, payload);
}

export class AuthorizerContextValidationError extends Error {}
