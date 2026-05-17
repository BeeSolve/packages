import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context,
} from "aws-lambda";
import * as v from "valibot";

const AwsV2EventSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.looseObject({
    version: v.literal("2.0"),
    rawPath: v.string(),
    rawQueryString: v.string(),
    routeKey: v.string(),
    requestContext: v.looseObject({}),
  }),
);

const AwsV1EventSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.looseObject({
    httpMethod: v.string(),
    path: v.string(),
    resource: v.string(),
    requestContext: v.looseObject({}),
  }),
);

const AwsContextSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.looseObject({
    functionName: v.string(),
    functionVersion: v.string(),
    invokedFunctionArn: v.string(),
    memoryLimitInMB: v.string(),
    awsRequestId: v.string(),
    logGroupName: v.string(),
    logStreamName: v.string(),
    callbackWaitsForEmptyEventLoop: v.boolean(),
    serializedAtTimeInMillis: v.number(),
    remainingTimeInMillis: v.number(),
  }),
);

function getAwsEventHeader(request: Request): string {
  const header = request.headers.get("aws-event");
  if (header == null)
    throw new MissingAwsEventHeaderError(
      `Provided request does not contain "aws-event" header.`,
    );
  return Buffer.from(header, "base64url").toString("utf8");
}

export function toAwsV2Event(request: Request): APIGatewayProxyEventV2 {
  const jsonString = getAwsEventHeader(request);
  try {
    return v.parse(
      AwsV2EventSchema,
      jsonString,
    ) as unknown as APIGatewayProxyEventV2;
  } catch {
    throw new InvalidAwsEventHeaderError(
      `Failed to parse "aws-event" header as API Gateway v2 event.`,
    );
  }
}

export function toAwsV1Event(request: Request): APIGatewayProxyEvent {
  const jsonString = getAwsEventHeader(request);
  try {
    return v.parse(
      AwsV1EventSchema,
      jsonString,
    ) as unknown as APIGatewayProxyEvent;
  } catch {
    throw new InvalidAwsEventHeaderError(
      `Failed to parse "aws-event" header as API Gateway v1 event.`,
    );
  }
}

export function toAwsEvent(
  request: Request,
): APIGatewayProxyEvent | APIGatewayProxyEventV2 {
  const jsonString = getAwsEventHeader(request);

  const v2 = v.safeParse(AwsV2EventSchema, jsonString);
  if (v2.success) return v2.output as unknown as APIGatewayProxyEventV2;

  const v1 = v.safeParse(AwsV1EventSchema, jsonString);
  if (v1.success) return v1.output as unknown as APIGatewayProxyEvent;

  throw new InvalidAwsEventHeaderError(
    `Failed to parse "aws-event" header as a recognised API Gateway event.`,
  );
}

export function toAwsContext(request: Request): Context {
  const header = request.headers.get("aws-context");
  if (header == null)
    throw new MissingAwsContextHeaderError(
      `Provided request does not contain "aws-context" header.`,
    );

  const jsonString = Buffer.from(header, "base64url").toString("utf8");

  const result = v.safeParse(AwsContextSchema, jsonString);
  if (!result.success)
    throw new InvalidAwsContextHeaderError(
      `Failed to parse "aws-context" header.`,
    );

  const { serializedAtTimeInMillis, remainingTimeInMillis, ...rest } = result.output;

  return {
    ...rest,
    getRemainingTimeInMillis: () => {
      const diff = Date.now() - serializedAtTimeInMillis;
      return remainingTimeInMillis - diff;
    },
  } as Context;
}

export function withAwsEvent(
  request: Request,
  event: APIGatewayProxyEventV2 | APIGatewayProxyEvent,
): Request {
  const headers = new Headers(request.headers);
  headers.append(
    "aws-event",
    Buffer.from(JSON.stringify(event)).toString("base64url"),
  );
  return new Request(request, { headers });
}

export function withAwsContext(request: Request, context: Context): Request {
  const headers = new Headers(request.headers);
  headers.append(
    "aws-context",
    Buffer.from(
      JSON.stringify({
        ...context,
        serializedAtTimeInMillis: Date.now(),
        remainingTimeInMillis: context.getRemainingTimeInMillis(),
      }),
    ).toString("base64url"),
  );
  return new Request(request, { headers });
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

export class MissingAwsEventHeaderError extends Error {}
export class MissingAwsContextHeaderError extends Error {}
export class InvalidAwsEventHeaderError extends Error {}
export class InvalidAwsContextHeaderError extends Error {}
