import type { StandardSchemaV1 } from "@standard-schema/spec";

import { isAPIGatewayProxyEventV2 } from "./runtime";
import { getAwsEvent } from "./store";

/**
 * Returns true if the current Lambda event contains authorizer context
 * (either v1 REST API or v2 HTTP API format).
 *
 * Use this to check whether the authorizer ran before attempting to parse
 * the context — avoids throwing when the request was not authorized
 * (e.g. public endpoints on SSR apps).
 */
export function hasAuthorizerContext(): boolean {
  const event = getAwsEvent();
  if (isAPIGatewayProxyEventV2(event)) {
    return hasLambdaAuthorizer(event.requestContext);
  }
  return hasAuthorizer(event.requestContext);
}

/**
 * Returns the Lambda authorizer payload for HTTP API v2 events.
 * Reads `event.requestContext.authorizer.lambda`.
 */
export function getAwsLambdaAuthorizerContext<T extends StandardSchemaV1>(
  schema: T,
): Promise<StandardSchemaV1.InferOutput<T>> {
  const event = getAwsEvent();
  const payload = hasLambdaAuthorizer(event.requestContext)
    ? event.requestContext.authorizer.lambda
    : undefined;
  return parseWithSchema({ schema, payload });
}

/**
 * Returns the custom authorizer context for REST API v1 events.
 * Reads `event.requestContext.authorizer`.
 */
export function getAwsCustomAuthorizerContext<T extends StandardSchemaV1>(
  schema: T,
): Promise<StandardSchemaV1.InferOutput<T>> {
  const event = getAwsEvent();
  const payload = hasAuthorizer(event.requestContext) ? event.requestContext.authorizer : undefined;
  return parseWithSchema({ schema, payload });
}

export class AuthorizerContextValidationError extends Error {}

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

async function parseWithSchema<T extends StandardSchemaV1>(props: {
  schema: T;
  payload: unknown;
}): Promise<StandardSchemaV1.InferOutput<T>> {
  const result = await props.schema["~standard"].validate(props.payload);
  if (result.issues != null)
    throw new AuthorizerContextValidationError(result.issues.map((i) => i.message).join("; "));
  return result.value;
}
