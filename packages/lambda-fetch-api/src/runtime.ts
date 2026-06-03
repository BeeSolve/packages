import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";

export function isAPIGatewayProxyEvent(event: any): event is APIGatewayProxyEvent {
  return (
    typeof event.httpMethod === "string" &&
    typeof event.path === "string" &&
    typeof event.resource === "string" &&
    typeof event.requestContext === "object"
  );
}

export function isAPIGatewayProxyEventV2(event: any): event is APIGatewayProxyEventV2 {
  return (
    event.version === "2.0" &&
    typeof event.rawPath === "string" &&
    typeof event.rawQueryString === "string" &&
    typeof event.routeKey === "string" &&
    typeof event.requestContext === "object"
  );
}
