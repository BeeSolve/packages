import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, test } from "bun:test";
import {
	InvalidAwsContextHeaderError,
	InvalidAwsEventHeaderError,
	MissingAwsContextHeaderError,
	MissingAwsEventHeaderError,
	awsRequest,
	awsResponseBody,
	awsResponseHeaders,
	isAPIGatewayProxyEvent,
	isAPIGatewayProxyEventV2,
	toAwsContext,
	toAwsEvent,
	toAwsV1Event,
	toAwsV2Event,
	withAwsContext,
	withAwsEvent,
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

function makeV2Event(
	overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
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

function makeV1Event(
	overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
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
		const request = awsRequest(makeV2Event(), makeContext());
		expect(request.method).toBe("GET");
		expect(new URL(request.url).pathname).toBe("/test");
	});

	test("includes query string from v2 event", () => {
		const request = awsRequest(
			makeV2Event({ rawQueryString: "foo=bar&baz=1" }),
			makeContext(),
		);
		const url = new URL(request.url);
		expect(url.searchParams.get("foo")).toBe("bar");
		expect(url.searchParams.get("baz")).toBe("1");
	});

	test("builds correct method from v1 event", () => {
		const request = awsRequest(makeV1Event(), makeContext());
		expect(request.method).toBe("POST");
		expect(new URL(request.url).pathname).toBe("/hello");
	});

	test("sets aws-event header on the request", () => {
		const request = awsRequest(makeV2Event(), makeContext());
		expect(request.headers.has("aws-event")).toBe(true);
	});

	test("sets aws-context header on the request", () => {
		const request = awsRequest(makeV2Event(), makeContext());
		expect(request.headers.has("aws-context")).toBe(true);
	});
});

describe("awsResponseHeaders", () => {
	test("returns plain headers when no cookies", () => {
		const response = new Response("", {
			headers: { "content-type": "text/plain" },
		});
		const result = awsResponseHeaders(response, "v1");
		expect(result.headers["content-type"]).toBe("text/plain");
		expect((result as any).multiValueHeaders).toBeUndefined();
		expect((result as any).cookies).toBeUndefined();
	});

	test("v1: returns multiValueHeaders for set-cookie and omits it from headers", () => {
		const headers = new Headers({ "content-type": "text/html" });
		headers.append("set-cookie", "session=abc; Path=/");
		const response = new Response("", { headers });
		const result = awsResponseHeaders(response, "v1") as {
			headers: Record<string, string>;
			multiValueHeaders: { "set-cookie": string[] };
		};
		expect(result.multiValueHeaders["set-cookie"]).toEqual([
			"session=abc; Path=/",
		]);
		expect(result.headers["set-cookie"]).toBeUndefined();
	});

	test("v2: returns cookies array for set-cookie and omits it from headers", () => {
		const headers = new Headers({ "content-type": "text/html" });
		headers.append("set-cookie", "session=abc; Path=/");
		const response = new Response("", { headers });
		const result = awsResponseHeaders(response, "v2") as {
			headers: Record<string, string>;
			cookies: string[];
		};
		expect(result.cookies).toEqual(["session=abc; Path=/"]);
		expect(result.headers["set-cookie"]).toBeUndefined();
	});
});

describe("toAwsEvent", () => {
	test("round-trips a v2 event through the request headers", () => {
		const event = makeV2Event();
		const request = awsRequest(event, makeContext());
		const recovered = toAwsEvent(request);
		expect(recovered).toMatchObject({ version: "2.0", rawPath: "/test" });
	});

	test("round-trips a v1 event through the request headers", () => {
		const event = makeV1Event();
		const request = awsRequest(event, makeContext());
		const recovered = toAwsEvent(request);
		expect(recovered).toMatchObject({ httpMethod: "POST", path: "/hello" });
	});

	test("throws MissingAwsEventHeaderError when header is absent", () => {
		const request = new Request("https://example.com");
		expect(() => toAwsEvent(request)).toThrow(MissingAwsEventHeaderError);
	});

	test("throws InvalidAwsEventHeaderError for unrecognised event shape", () => {
		const headers = new Headers();
		headers.set("aws-event", Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url"));
		const request = new Request("https://example.com", { headers });
		expect(() => toAwsEvent(request)).toThrow(InvalidAwsEventHeaderError);
	});
});

describe("toAwsV2Event", () => {
	test("round-trips a v2 event", () => {
		const event = makeV2Event();
		const request = awsRequest(event, makeContext());
		const recovered = toAwsV2Event(request);
		expect(recovered).toMatchObject({ version: "2.0", rawPath: "/test" });
	});

	test("throws MissingAwsEventHeaderError when header is absent", () => {
		const request = new Request("https://example.com");
		expect(() => toAwsV2Event(request)).toThrow(MissingAwsEventHeaderError);
	});

	test("throws InvalidAwsEventHeaderError when header contains a v1 event", () => {
		const request = awsRequest(makeV1Event(), makeContext());
		expect(() => toAwsV2Event(request)).toThrow(InvalidAwsEventHeaderError);
	});
});

describe("toAwsV1Event", () => {
	test("round-trips a v1 event", () => {
		const event = makeV1Event();
		const request = awsRequest(event, makeContext());
		const recovered = toAwsV1Event(request);
		expect(recovered).toMatchObject({ httpMethod: "POST", path: "/hello" });
	});

	test("throws MissingAwsEventHeaderError when header is absent", () => {
		const request = new Request("https://example.com");
		expect(() => toAwsV1Event(request)).toThrow(MissingAwsEventHeaderError);
	});

	test("throws InvalidAwsEventHeaderError when header contains a v2 event", () => {
		const request = awsRequest(makeV2Event(), makeContext());
		expect(() => toAwsV1Event(request)).toThrow(InvalidAwsEventHeaderError);
	});
});

describe("toAwsContext", () => {
	test("round-trips context through the request headers", () => {
		const ctx = makeContext();
		const request = awsRequest(makeV2Event(), ctx);
		const recovered = toAwsContext(request);
		expect(recovered.functionName).toBe("test-fn");
		expect(recovered.awsRequestId).toBe("req-123");
	});

	test("getRemainingTimeInMillis decreases over time", () => {
		const ctx = makeContext();
		const request = awsRequest(makeV2Event(), ctx);
		const recovered = toAwsContext(request);
		const t1 = recovered.getRemainingTimeInMillis();
		const t2 = recovered.getRemainingTimeInMillis();
		expect(t1).toBeLessThanOrEqual(10_000);
		expect(t2).toBeLessThanOrEqual(t1);
	});

	test("throws MissingAwsContextHeaderError when header is absent", () => {
		const request = new Request("https://example.com");
		expect(() => toAwsContext(request)).toThrow(MissingAwsContextHeaderError);
	});

	test("throws InvalidAwsContextHeaderError for invalid context shape", () => {
		const headers = new Headers();
		headers.set("aws-context", Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url"));
		const request = new Request("https://example.com", { headers });
		expect(() => toAwsContext(request)).toThrow(InvalidAwsContextHeaderError);
	});
});

describe("withAwsEvent", () => {
	test("round-trips v2 event via withAwsEvent + toAwsV2Event", () => {
		const event = makeV2Event();
		const base = new Request("https://example.com");
		const request = withAwsEvent(base, event);
		const recovered = toAwsV2Event(request);
		expect(recovered).toMatchObject({ version: "2.0", rawPath: "/test" });
	});

	test("round-trips v1 event via withAwsEvent + toAwsV1Event", () => {
		const event = makeV1Event();
		const base = new Request("https://example.com");
		const request = withAwsEvent(base, event);
		const recovered = toAwsV1Event(request);
		expect(recovered).toMatchObject({ httpMethod: "POST", path: "/hello" });
	});

	test("does not mutate the original request", () => {
		const base = new Request("https://example.com");
		withAwsEvent(base, makeV2Event());
		expect(base.headers.has("aws-event")).toBe(false);
	});
});

describe("withAwsContext", () => {
	test("round-trips context via withAwsContext + toAwsContext", () => {
		const ctx = makeContext();
		const base = new Request("https://example.com");
		const request = withAwsContext(base, ctx);
		const recovered = toAwsContext(request);
		expect(recovered.functionName).toBe("test-fn");
		expect(recovered.awsRequestId).toBe("req-123");
	});

	test("does not mutate the original request", () => {
		const base = new Request("https://example.com");
		withAwsContext(base, makeContext());
		expect(base.headers.has("aws-context")).toBe(false);
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
		expect(result.body).toBe(
			Buffer.from([1, 2, 3, 255]).toString("base64"),
		);
	});

	test("returns empty body when response has no body", async () => {
		const response = new Response(null);
		const result = await awsResponseBody(response);
		expect(result.body).toBe("");
	});
});
