import { describe, expect, test } from "bun:test";

import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from "aws-lambda";

import {
  NotInHandlerContextError,
  awsRequest,
  awsResponseBody,
  awsResponseHeaders,
  getAwsContext,
  getAwsEvent,
  getAwsV1Event,
  getAwsV2Event,
  isAPIGatewayProxyEvent,
  isAPIGatewayProxyEventV2,
  runWithAwsContext,
} from "../index";

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
    done: () => {},
    fail: () => {},
    succeed: () => {},
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

function makeV1Event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "POST",
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
      httpMethod: "POST",
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

describe("isAPIGatewayProxyEvent", () => {
  test("returns true for v1 event shape", () => {
    expect(isAPIGatewayProxyEvent(makeV1Event())).toBe(true);
  });

  test("returns false for v2 event shape", () => {
    expect(isAPIGatewayProxyEvent(makeV2Event())).toBe(false);
  });

  test("returns false for non-event objects", () => {
    expect(isAPIGatewayProxyEvent({})).toBe(false);
  });
});

describe("isAPIGatewayProxyEventV2", () => {
  test("returns true for v2 event shape", () => {
    expect(isAPIGatewayProxyEventV2(makeV2Event())).toBe(true);
  });

  test("returns false for v1 event shape", () => {
    expect(isAPIGatewayProxyEventV2(makeV1Event())).toBe(false);
  });
});

describe("awsRequest", () => {
  test("builds correct method and path from v2 event", () => {
    const request = awsRequest(makeV2Event());
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/test");
  });

  test("includes query string from v2 event", () => {
    const request = awsRequest(makeV2Event({ rawQueryString: "foo=bar&baz=1" }));
    const url = new URL(request.url);
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("baz")).toBe("1");
  });

  test("builds correct method from v1 event", () => {
    const request = awsRequest(makeV1Event());
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/hello");
  });

  test("does not set aws-event header", () => {
    const request = awsRequest(makeV2Event());
    expect(request.headers.has("aws-event")).toBe(false);
  });

  test("does not set aws-context header", () => {
    const request = awsRequest(makeV2Event());
    expect(request.headers.has("aws-context")).toBe(false);
  });
});

describe("awsResponseHeaders", () => {
  test("returns plain headers when no cookies", () => {
    const response = new Response("", {
      headers: { "content-type": "text/plain" },
    });
    const result = awsResponseHeaders(response, "v1");
    expect(result.headers["content-type"]).toBe("text/plain");
    expect((result as unknown as Record<string, unknown>).multiValueHeaders).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).cookies).toBeUndefined();
  });

  test("v1: returns multiValueHeaders for set-cookie and omits it from headers", () => {
    const headers = new Headers({ "content-type": "text/html" });
    headers.append("set-cookie", "session=abc; Path=/");
    const response = new Response("", { headers });
    const result = awsResponseHeaders(response, "v1") as {
      headers: Record<string, string>;
      multiValueHeaders: { "set-cookie": Array<string> };
    };
    expect(result.multiValueHeaders["set-cookie"]).toEqual(["session=abc; Path=/"]);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });

  test("v2: returns cookies array for set-cookie and omits it from headers", () => {
    const headers = new Headers({ "content-type": "text/html" });
    headers.append("set-cookie", "session=abc; Path=/");
    const response = new Response("", { headers });
    const result = awsResponseHeaders(response, "v2") as {
      headers: Record<string, string>;
      cookies: Array<string>;
    };
    expect(result.cookies).toEqual(["session=abc; Path=/"]);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
});

describe("getAwsEvent", () => {
  test("returns the v2 event inside runWithAwsContext", async () => {
    const event = makeV2Event();
    const ctx = makeContext();
    const recovered = await runWithAwsContext(event, ctx, () => getAwsEvent());
    expect(recovered).toMatchObject({ version: "2.0", rawPath: "/test" });
  });

  test("returns the v1 event inside runWithAwsContext", async () => {
    const event = makeV1Event();
    const ctx = makeContext();
    const recovered = await runWithAwsContext(event, ctx, () => getAwsEvent());
    expect(recovered).toMatchObject({ httpMethod: "POST", path: "/hello" });
  });

  test("returns the same object reference (no copy)", async () => {
    const event = makeV2Event();
    const recovered = await runWithAwsContext(event, makeContext(), () => getAwsEvent());
    expect(recovered).toBe(event);
  });

  test("throws NotInHandlerContextError outside a handler", () => {
    expect(() => getAwsEvent()).toThrow(NotInHandlerContextError);
  });
});

describe("getAwsV2Event", () => {
  test("returns the v2 event", async () => {
    const event = makeV2Event();
    const recovered = await runWithAwsContext(event, makeContext(), () => getAwsV2Event());
    expect(recovered).toMatchObject({ version: "2.0", rawPath: "/test" });
  });

  test("throws NotInHandlerContextError when event is v1", async () => {
    await expect(
      runWithAwsContext(makeV1Event(), makeContext(), () => getAwsV2Event()),
    ).rejects.toThrow(NotInHandlerContextError);
  });

  test("throws NotInHandlerContextError outside a handler", () => {
    expect(() => getAwsV2Event()).toThrow(NotInHandlerContextError);
  });
});

describe("getAwsV1Event", () => {
  test("returns the v1 event", async () => {
    const event = makeV1Event();
    const recovered = await runWithAwsContext(event, makeContext(), () => getAwsV1Event());
    expect(recovered).toMatchObject({ httpMethod: "POST", path: "/hello" });
  });

  test("throws NotInHandlerContextError when event is v2", async () => {
    await expect(
      runWithAwsContext(makeV2Event(), makeContext(), () => getAwsV1Event()),
    ).rejects.toThrow(NotInHandlerContextError);
  });

  test("throws NotInHandlerContextError outside a handler", () => {
    expect(() => getAwsV1Event()).toThrow(NotInHandlerContextError);
  });
});

describe("getAwsContext", () => {
  test("returns the context inside runWithAwsContext", async () => {
    const ctx = makeContext();
    const recovered = await runWithAwsContext(makeV2Event(), ctx, () => getAwsContext());
    expect(recovered.functionName).toBe("test-fn");
    expect(recovered.awsRequestId).toBe("req-123");
  });

  test("getRemainingTimeInMillis works natively", async () => {
    const ctx = makeContext();
    const recovered = await runWithAwsContext(makeV2Event(), ctx, () => getAwsContext());
    expect(recovered.getRemainingTimeInMillis()).toBe(10_000);
  });

  test("returns the same context reference (no copy)", async () => {
    const ctx = makeContext();
    const recovered = await runWithAwsContext(makeV2Event(), ctx, () => getAwsContext());
    expect(recovered).toBe(ctx);
  });

  test("throws NotInHandlerContextError outside a handler", () => {
    expect(() => getAwsContext()).toThrow(NotInHandlerContextError);
  });
});

describe("awsResponseBody", () => {
  test("returns text body for text/plain content type", async () => {
    const response = new Response("hello world", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
    const result = await awsResponseBody(response);
    expect(result.body).toBe("hello world");
    expect(result.isBase64Encoded).toBeUndefined();
  });

  test("returns text body for application/json content type", async () => {
    const response = new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
    const result = await awsResponseBody(response);
    expect(result.body).toBe('{"ok":true}');
    expect(result.isBase64Encoded).toBeUndefined();
  });

  test("returns base64 body for binary content types", async () => {
    const data = new Uint8Array([1, 2, 3, 255]);
    const response = new Response(data, {
      headers: { "content-type": "image/png" },
    });
    const result = await awsResponseBody(response);
    expect(result.isBase64Encoded).toBe(true);
    expect(result.body).toBe(Buffer.from([1, 2, 3, 255]).toString("base64"));
  });

  test("returns empty body when response has no body", async () => {
    const response = new Response(null);
    const result = await awsResponseBody(response);
    expect(result.body).toBe("");
  });
});
