import type {
	APIGatewayProxyEvent,
	APIGatewayProxyEventV2WithLambdaAuthorizer,
	APIGatewayProxyWithLambdaAuthorizerEvent,
	Context,
} from "aws-lambda";
import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
	AuthorizerContextValidationError,
	NotInHandlerContextError,
	asCustomAuthorizedHttpV1Handler,
	asLambdaAuthorizedHttpV2Handler,
	getAwsCustomAuthorizerContext,
	getAwsLambdaAuthorizerContext,
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

function makeV2EventWithLambdaAuthorizer<T>(
	authPayload: T,
): APIGatewayProxyEventV2WithLambdaAuthorizer<T> {
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
			authorizer: { lambda: authPayload },
		},
		isBase64Encoded: false,
	};
}

function makeV1EventWithCustomAuthorizer(
	authPayload: Record<string, string>,
): APIGatewayProxyWithLambdaAuthorizerEvent<Record<string, string>> {
	const base: APIGatewayProxyEvent = {
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
			authorizer: authPayload,
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
	};
	return base as unknown as APIGatewayProxyWithLambdaAuthorizerEvent<Record<string, string>>;
}

const AuthSchema = v.object({ userId: v.string(), role: v.string() });

describe("getAwsLambdaAuthorizerContext", () => {
	test("returns raw payload without schema", async () => {
		const event = makeV2EventWithLambdaAuthorizer({ userId: "u1", role: "admin" });
		const payload = await runWithAwsContext(event, makeContext(), () =>
			getAwsLambdaAuthorizerContext(),
		);
		expect(payload).toEqual({ userId: "u1", role: "admin" });
	});

	test("validates and types payload with a Standard Schema", async () => {
		const event = makeV2EventWithLambdaAuthorizer({ userId: "u1", role: "admin" });
		const auth = await runWithAwsContext(event, makeContext(), () =>
			getAwsLambdaAuthorizerContext(AuthSchema),
		);
		expect(auth.userId).toBe("u1");
		expect(auth.role).toBe("admin");
	});

	test("throws AuthorizerContextValidationError when schema fails", async () => {
		const event = makeV2EventWithLambdaAuthorizer({ bad: "data" });
		await expect(
			runWithAwsContext(event, makeContext(), () =>
				getAwsLambdaAuthorizerContext(AuthSchema),
			),
		).rejects.toThrow(AuthorizerContextValidationError);
	});

	test("throws NotInHandlerContextError outside a handler", () => {
		expect(() => getAwsLambdaAuthorizerContext()).toThrow(NotInHandlerContextError);
	});
});

describe("getAwsCustomAuthorizerContext", () => {
	test("returns raw payload without schema", async () => {
		const event = makeV1EventWithCustomAuthorizer({ userId: "u2", role: "editor" });
		const payload = await runWithAwsContext(event, makeContext(), () =>
			getAwsCustomAuthorizerContext(),
		);
		expect(payload).toMatchObject({ userId: "u2", role: "editor" });
	});

	test("validates and types payload with a Standard Schema", async () => {
		const event = makeV1EventWithCustomAuthorizer({ userId: "u2", role: "editor" });
		const auth = await runWithAwsContext(event, makeContext(), () =>
			getAwsCustomAuthorizerContext(AuthSchema),
		);
		expect(auth.userId).toBe("u2");
		expect(auth.role).toBe("editor");
	});

	test("throws AuthorizerContextValidationError when schema fails", async () => {
		const event = makeV1EventWithCustomAuthorizer({});
		await expect(
			runWithAwsContext(event, makeContext(), () =>
				getAwsCustomAuthorizerContext(AuthSchema),
			),
		).rejects.toThrow(AuthorizerContextValidationError);
	});

	test("throws NotInHandlerContextError outside a handler", () => {
		expect(() => getAwsCustomAuthorizerContext()).toThrow(NotInHandlerContextError);
	});
});

describe("asLambdaAuthorizedHttpV2Handler", () => {
	test("passes status code through", async () => {
		const handler = asLambdaAuthorizedHttpV2Handler(
			async () => new Response("", { status: 200 }),
		);
		const result = await handler(
			makeV2EventWithLambdaAuthorizer({ userId: "u1" }),
			makeContext(),
		);
		expect(result.statusCode).toBe(200);
	});

	test("authorizer context is accessible inside fetch via getAwsLambdaAuthorizerContext", async () => {
		let capturedAuth: unknown;
		const handler = asLambdaAuthorizedHttpV2Handler(async () => {
			capturedAuth = getAwsLambdaAuthorizerContext();
			return new Response("");
		});
		await handler(
			makeV2EventWithLambdaAuthorizer({ userId: "u1", role: "admin" }),
			makeContext(),
		);
		expect(capturedAuth).toEqual({ userId: "u1", role: "admin" });
	});
});

describe("asCustomAuthorizedHttpV1Handler", () => {
	test("passes status code through", async () => {
		const handler = asCustomAuthorizedHttpV1Handler(
			async () => new Response("", { status: 200 }),
		);
		const result = await handler(
			makeV1EventWithCustomAuthorizer({ userId: "u2" }),
			makeContext(),
		);
		expect(result.statusCode).toBe(200);
	});

	test("authorizer context is accessible inside fetch via getAwsCustomAuthorizerContext", async () => {
		let capturedAuth: unknown;
		const handler = asCustomAuthorizedHttpV1Handler(async () => {
			capturedAuth = getAwsCustomAuthorizerContext();
			return new Response("");
		});
		await handler(
			makeV1EventWithCustomAuthorizer({ userId: "u2", role: "editor" }),
			makeContext(),
		);
		expect(capturedAuth).toMatchObject({ userId: "u2", role: "editor" });
	});
});
