---
"@beesolve/lambda-fetch-api": minor
---

Add authorizer handler variants and Standard Schema-compatible payload getters.

**New handler variants:**

- `asLambdaAuthorizedHttpV2Handler<TAuth>(fetch)` — for HTTP API v2 routes protected by a Lambda authorizer; the Lambda event is typed as `APIGatewayProxyEventV2WithLambdaAuthorizer<TAuth>`
- `asCustomAuthorizedHttpV1Handler<TAuth>(fetch)` — for REST API v1 routes with a custom/Lambda authorizer; the event is typed as `APIGatewayProxyWithLambdaAuthorizerEvent<TAuth>`

**New payload getters (callable inside any handler invocation):**

- `getAwsLambdaAuthorizerContext()` — returns `unknown`; reads `event.requestContext.authorizer.lambda` from the stored v2 event
- `getAwsLambdaAuthorizerContext(schema)` — validates the payload with any [Standard Schema](https://standardschema.dev/) compatible library (valibot, zod, arktype, …) and returns `Promise<OutputType>`
- `getAwsCustomAuthorizerContext()` — returns `unknown`; reads `event.requestContext.authorizer` from the stored v1 event
- `getAwsCustomAuthorizerContext(schema)` — same as above with schema validation

**New error class:** `AuthorizerContextValidationError` — thrown when the schema rejects the authorizer payload.

The `StandardSchemaV1` interface is exported from the package so consumers can reference it without an additional dependency.
