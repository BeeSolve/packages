---
"@beesolve/auth-service": minor
"@beesolve/lambda-fetch-api": patch
---

Add SSR session integration patterns for SvelteKit apps.

- `createInProcessSessionHandle` — resolves sessions directly from DynamoDB without the API Gateway authorizer
- `grantSessionAccess()` CDK method for granting a Lambda direct DynamoDB session access
- `ensureCookieFunction` CloudFront Function to inject placeholder cookie for authorizer identity source
- `"disabled"` authorizerCache mode for SSR apps where requests without cookies must reach the authorizer
- `SessionContext` adds `"none"` type for routes where the authorizer did not run
- `hasAuthorizerContext()` utility in lambda-fetch-api to detect authorizer presence
