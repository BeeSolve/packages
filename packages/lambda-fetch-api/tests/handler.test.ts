import { describe, expect, test } from "bun:test";

import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from "aws-lambda";

import { asHttpV1Handler, asHttpV2Handler } from "../index";

function makeContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-fn",
    functionVersion: "1",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:123:function:test-fn",
    memoryLimitInMB: "128",
    awsRequestId: "req-123",
    logGroupName: "/aws/lambda/test-fn",
    logStreamName: "2024/01/01/[$LATEST]abc",
    getRemainingTimeInMillis: () => 10_000,
  };
}

function makeV1Event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/hello",
    resource: "/hello",
    headers: { host: "api.example.com" },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: "123",
      apiId: "abc",
      authorizer: null,
      httpMethod: "GET",
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: "1.2.3.4",
        user: null,
        userAgent: "test",
        userArn: null,
      },
      path: "/hello",
      protocol: "HTTP/1.1",
      requestId: "req1",
      requestTimeEpoch: 0,
      resourceId: "abc",
      resourcePath: "/hello",
      stage: "prod",
    },
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

function makeV2Event(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /test",
    rawPath: "/test",
    rawQueryString: "",
    headers: { host: "api.example.com" },
    requestContext: {
      accountId: "123",
      apiId: "abc",
      domainName: "api.example.com",
      domainPrefix: "abc",
      http: {
        method: "GET",
        path: "/test",
        protocol: "HTTP/1.1",
        sourceIp: "1.2.3.4",
        userAgent: "test",
      },
      requestId: "req1",
      routeKey: "GET /test",
      stage: "$default",
      time: "01/Jan/2024:00:00:00 +0000",
      timeEpoch: 1_704_067_200_000,
    },
    isBase64Encoded: false,
    ...overrides,
  };
}

describe("asHttpV1Handler", () => {
  test("passes status code through", async () => {
    const handler = asHttpV1Handler(async () => new Response("", { status: 204 }));
    const result = await handler(makeV1Event(), makeContext());
    expect(result.statusCode).toBe(204);
  });

  test("returns text body as-is", async () => {
    const handler = asHttpV1Handler(
      async () => new Response("hello", { headers: { "content-type": "text/plain" } }),
    );
    const result = await handler(makeV1Event(), makeContext());
    expect(result.body).toBe("hello");
    expect(result.isBase64Encoded).toBeUndefined();
  });

  test("returns binary body as base64", async () => {
    const data = new Uint8Array([1, 2, 3, 255]);
    const handler = asHttpV1Handler(
      async () => new Response(data, { headers: { "content-type": "image/png" } }),
    );
    const result = await handler(makeV1Event(), makeContext());
    expect(result.isBase64Encoded).toBe(true);
    expect(result.body).toBe(Buffer.from([1, 2, 3, 255]).toString("base64"));
  });

  test("set-cookie goes into multiValueHeaders, not headers", async () => {
    const handler = asHttpV1Handler(async () => {
      const headers = new Headers({ "content-type": "text/plain" });
      headers.append("set-cookie", "session=abc; Path=/");
      headers.append("set-cookie", "theme=dark; Path=/");
      return new Response("", { headers });
    });
    const result = await handler(makeV1Event(), makeContext());
    expect(result.multiValueHeaders?.["set-cookie"]).toEqual([
      "session=abc; Path=/",
      "theme=dark; Path=/",
    ]);
    expect(result.headers?.["set-cookie"]).toBeUndefined();
  });

  test("fetch receives correct method and path from event", async () => {
    let capturedRequest: Request | undefined;
    const handler = asHttpV1Handler(async (req) => {
      capturedRequest = req;
      return new Response("");
    });
    await handler(makeV1Event({ httpMethod: "POST", path: "/submit" }), makeContext());
    expect(capturedRequest?.method).toBe("POST");
    expect(new URL(capturedRequest?.url ?? "").pathname).toBe("/submit");
  });
});

describe("asHttpV2Handler", () => {
  test("passes status code through", async () => {
    const handler = asHttpV2Handler(async () => new Response("", { status: 201 }));
    const result = await handler(makeV2Event(), makeContext());
    expect(result.statusCode).toBe(201);
  });

  test("returns JSON body as-is", async () => {
    const handler = asHttpV2Handler(
      async () =>
        new Response('{"ok":true}', {
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await handler(makeV2Event(), makeContext());
    expect(result.body).toBe('{"ok":true}');
    expect(result.isBase64Encoded).toBeUndefined();
  });

  test("returns binary body as base64", async () => {
    const data = new Uint8Array([0, 1, 2]);
    const handler = asHttpV2Handler(
      async () =>
        new Response(data, {
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    const result = await handler(makeV2Event(), makeContext());
    expect(result.isBase64Encoded).toBe(true);
    expect(result.body).toBe(Buffer.from([0, 1, 2]).toString("base64"));
  });

  test("set-cookie goes into cookies, not headers", async () => {
    const handler = asHttpV2Handler(async () => {
      const headers = new Headers({ "content-type": "text/plain" });
      headers.append("set-cookie", "session=abc; Path=/");
      headers.append("set-cookie", "theme=dark; Path=/");
      return new Response("", { headers });
    });
    const result = await handler(makeV2Event(), makeContext());
    expect(result.cookies).toEqual(["session=abc; Path=/", "theme=dark; Path=/"]);
    expect(result.headers?.["set-cookie"]).toBeUndefined();
  });

  test("fetch receives correct method and path from event", async () => {
    let capturedRequest: Request | undefined;
    const handler = asHttpV2Handler(async (req) => {
      capturedRequest = req;
      return new Response("");
    });
    await handler(
      makeV2Event({
        rawPath: "/api/items",
        requestContext: {
          ...makeV2Event().requestContext,
          http: {
            ...makeV2Event().requestContext.http,
            method: "DELETE",
            path: "/api/items",
          },
        },
      }),
      makeContext(),
    );
    expect(capturedRequest?.method).toBe("DELETE");
    expect(new URL(capturedRequest?.url ?? "").pathname).toBe("/api/items");
  });
});
