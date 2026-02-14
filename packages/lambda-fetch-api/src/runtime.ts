import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context,
} from "aws-lambda";

// todo: split to v1 and v2
// todo: validate with valibot
export function toAwsEvent(
  request: Request,
): APIGatewayProxyEvent | APIGatewayProxyEventV2 {
  const header = request.headers.get("aws-event");
  if (header == null)
    throw new MissingAwsEventHeaderError(
      `Provided request does not contain "aws-event" header.`,
    );

  return JSON.parse(header);
}

// todo: validate with valibot
export function toAwsContext(request: Request): Context {
  const header = request.headers.get("aws-context");
  if (header == null)
    throw new MissingAwsContextHeaderError(
      `Provided request does not contain "aws-context" header.`,
    );

  const {
    serializedAtTimeInMillis,
    remainingTimeInMillis,
    ...rest
  }: Omit<Context, "getRemainingTimeInMillis"> & {
    serializedAtTimeInMillis: number;
    remainingTimeInMillis: number;
  } = JSON.parse(header);

  return {
    ...rest,
    getRemainingTimeInMillis: () => {
      const diff = Date.now() - serializedAtTimeInMillis;
      return remainingTimeInMillis - diff;
    },
  };
}

export function isAPIGatewayProxyEvent(
  event: any,
): event is APIGatewayProxyEvent {
  return (
    typeof event.httpMethod === "string" &&
    typeof event.path === "string" &&
    typeof event.resource === "string" &&
    typeof event.requestContext === "object"
  );
}

export function isAPIGatewayProxyEventV2(
  event: any,
): event is APIGatewayProxyEventV2 {
  return (
    event.version === "2.0" &&
    typeof event.rawPath === "string" &&
    typeof event.rawQueryString === "string" &&
    typeof event.routeKey === "string" &&
    typeof event.requestContext === "object"
  );
}

class MissingAwsEventHeaderError extends Error {}
class MissingAwsContextHeaderError extends Error {}

// todo: create helpers for authorizers
// const a: APIGatewayProxyEventV2WithLambdaAuthorizer<{ test: number }> =  {} as any;
// a.requestContext.authorizer.lambda.test;

// todo: create helpers for local testing eg. - also provide fake authorizers
function withAwsEvent(
  request: Request,
  event?: APIGatewayProxyEventV2 | APIGatewayProxyEvent,
): Request {
  request.headers.append("aws-event", "fakeevent");
  return request;
}

function withAwsContext(request: Request, context?: Context): Request {
  request.headers.append("aws-context", "fakeevent");
  return request;
}
