# Plan: Replace Origin Token with CloudFront OAC for Lambda Function URL

## Goal

Replace the current manual `x-origin-token` secret verification (which still invokes the Lambda on direct access) with CloudFront Origin Access Control (OAC). With OAC + `AWS_IAM` auth type, direct Lambda function URL invocations are rejected at the IAM layer — the Lambda is never invoked.

## Background

- CloudFront OAC for Lambda function URLs uses SigV4 to sign requests.
- For **GET** requests, CloudFront handles signing automatically.
- For **POST/PUT** requests, Lambda requires a signed payload. The client must provide `x-amz-content-sha256` (SHA-256 hash of the body) so CloudFront can include it in the SigV4 signature.
- CloudFront Functions **cannot** access the request body — ruled out.
- **Lambda@Edge** (origin-request, `includeBody: true`) can access the body (up to 1 MB) and inject the header. Auth payloads are tiny, so the 1 MB limit is irrelevant here.

## Architecture

```
Browser → CloudFront → Lambda@Edge (origin-request, computes body hash)
                     → OAC signs request with SigV4
                     → Lambda Function URL (AuthType: AWS_IAM)
```

Direct access to the Lambda function URL returns 403 Forbidden at the IAM layer (no Lambda invocation).

## CDK Changes (in `packages/service-auth/cdk.ts`)

### 1. Change Function URL auth type from `NONE` to `AWS_IAM`

```typescript
this.authUrl = authHandler.addFunctionUrl({
  authType: FunctionUrlAuthType.AWS_IAM,  // was NONE
  cors: { ... },
  invokeMode: InvokeMode.BUFFERED,
});
```

### 2. Create the OAC using the CDK L2 construct

```typescript
import { FunctionUrlOriginAccessControl } from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";

const oac = new FunctionUrlOriginAccessControl(this, "AuthOAC", {
  signing: Signing.SIGV4_ALWAYS,
});
```

### 3. Create a Lambda@Edge function to inject `x-amz-content-sha256`

A minimal origin-request Lambda@Edge that:
- Reads the request body (base64-decoded)
- Computes SHA-256 hash
- Sets `x-amz-content-sha256` header
- Passes request through for non-POST methods

```typescript
const bodyHashFn = new cloudfront.experimental.EdgeFunction(this, "BodyHashFn", {
  runtime: Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: Code.fromInline(`...`),  // ~10 lines, see below
});
```

Lambda@Edge handler:

```javascript
const crypto = require("crypto");
exports.handler = (event, _ctx, cb) => {
  const req = event.Records[0].cf.request;
  if (req.body && req.body.data) {
    const body = Buffer.from(req.body.data, "base64");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    req.headers["x-amz-content-sha256"] = [{ key: "x-amz-content-sha256", value: hash }];
  }
  cb(null, req);
};
```

### 4. Expose a CloudFront origin using `FunctionUrlOrigin.withOriginAccessControl`

```typescript
const authOrigin = FunctionUrlOrigin.withOriginAccessControl(this.authUrl, {
  originAccessControl: oac,
});
```

This origin + the Lambda@Edge association should be exposed from the construct so the consumer's CloudFront distribution can attach it.

### 5. Remove origin token infrastructure

- Remove the `Secret` construct (`OriginToken`)
- Remove `ORIGIN_TOKEN` from `authHandlerEnv`
- Remove token validation logic from the auth Lambda handler code
- Remove `originVerificationToken` public property (breaking change)

### 6. Grant CloudFront permission to invoke the function

The CDK `FunctionUrlOrigin.withOriginAccessControl` construct handles adding the resource-based policy (`lambda:InvokeFunctionUrl` with `cloudfront.amazonaws.com` principal + source ARN condition) automatically.

## Consumer-Side Changes

The consumer's CloudFront distribution must:
1. Use the exposed origin (from step 4) for the auth path pattern
2. Attach the Lambda@Edge function as an `origin-request` association with `includeBody: true`
3. Use `CachingDisabled` cache policy
4. Use `AllViewerExceptHostHeader` origin request policy
5. Remove the custom `x-origin-token` origin header (no longer needed)

## Constraints & Considerations

| Concern | Resolution |
|---------|-----------|
| Lambda@Edge body limit: 1 MB | Auth payloads are < 5 KB — no issue |
| Lambda@Edge must deploy to us-east-1 | Use `EdgeFunction` construct (handles cross-region) |
| Breaking change: `originVerificationToken` removed | Major version bump via changeset |
| WAF rule group | Still works — WAF attaches to CloudFront, unaffected by OAC |
| CORS | Must be configured on CloudFront behavior (Lambda URL CORS headers are stripped when auth type is AWS_IAM with OAC) |

## Migration Path

1. Deploy with both mechanisms active (OAC + token check) — allows rollback
2. Verify CloudFront → OAC → Lambda works for all endpoints
3. Remove token check in a follow-up release

## Required CDK Dependencies

- `aws-cdk-lib` (already present) — needs version with `FunctionUrlOriginAccessControl` (≥ 2.174.0)
- `aws-cdk-lib/aws-cloudfront-origins` — `FunctionUrlOrigin.withOriginAccessControl`

## Open Questions

- Should the Lambda@Edge function be part of this construct or a shared utility in `@beesolve/cdk-constructs`?
- Should the construct expose a full `BehaviorOptions` object for consumers, or just the origin + edge function separately?
