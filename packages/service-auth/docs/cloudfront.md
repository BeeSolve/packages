# CloudFront CDK example

This example shows a complete CDK stack that places a CloudFront distribution in front of both the auth endpoints and an application API, all on the same domain.

## Why same-domain matters

`__Host-SID` and `__Host-DataToken` are `__Host-` prefixed cookies. Browsers only send them to the exact origin that set them — there is no `Domain` attribute, so they cannot be shared across subdomains. By routing `/auth/*`, `/api/*`, and the frontend through a single CloudFront distribution, every request shares the same origin and cookies flow automatically without any manual token handling in your frontend code.

## Stack

```ts
import { Auth } from "@beesolve/auth-service/cdk";
import { Fn, Stack, type StackProps } from "aws-cdk-lib";
import {
  Distribution,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import {
  HttpOrigin,
  S3StaticWebsiteOrigin,
} from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Frontend assets -------------------------------------------------
    const frontendBucket = new Bucket(this, "FrontendBucket", {
      websiteIndexDocument: "index.html",
    });

    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(frontendBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    const frontendUri = `https://${distribution.distributionDomainName}`;

    // --- Auth ------------------------------------------------------------
    const auth = new Auth(this, "Auth", {
      stage: "prod",
      frontendUri,
      allowSignUp: true,
    });

    // --- Application API -------------------------------------------------
    const apiHandler = new Function(this, "ApiHandler", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline(`exports.handler = async () => ({ statusCode: 200, body: "ok" })`),
    });

    auth.addAuthorizedEndpoint({ lambda: apiHandler });

    // --- CloudFront behaviors --------------------------------------------

    // /auth/* → Lambda function URL with OAC (includes Lambda@Edge for body hashing)
    distribution.addBehavior("/auth/*", auth.authBehavior.origin, auth.authBehavior);

    // /api/* → API Gateway HTTP API (session-protected routes)
    distribution.addBehavior("/api/*", new HttpOrigin(Fn.parseDomainName(auth.api.url!)), {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    });
  }
}
```

## What each piece does

| Behavior | Origin | Purpose |
|---|---|---|
| `/*` (default) | S3 bucket | Serves your frontend SPA |
| `/auth/*` | `auth.authBehavior` | Auth handler — OAC-signed, Lambda@Edge computes body hash for SigV4 |
| `/api/*` | `HttpOrigin(auth.api.url)` | API Gateway — the Lambda authorizer validates `__Host-SID` on every request |

## How OAC works

CloudFront Origin Access Control (OAC) signs requests to the Lambda function URL using SigV4. The function URL has `AuthType: AWS_IAM`, so direct access (without a valid SigV4 signature) is rejected at the IAM layer — the Lambda is never invoked.

For POST requests, SigV4 requires the body hash (`x-amz-content-sha256`). A Lambda@Edge function (origin-request, `includeBody: true`) computes this header automatically. This is already wired into `auth.authBehavior`.

## CORS

With `AWS_IAM` auth type, CORS configured on the function URL is not applied. Add a CloudFront response headers policy to your `/auth/*` behavior if you need CORS headers:

```ts
import { ResponseHeadersPolicy, HeadersFrameOption, HeadersReferrerPolicy } from "aws-cdk-lib/aws-cloudfront";

const corsPolicy = new ResponseHeadersPolicy(this, "AuthCors", {
  corsBehavior: {
    accessControlAllowOrigins: [frontendUri],
    accessControlAllowMethods: ["POST"],
    accessControlAllowHeaders: ["content-type", "cookie"],
    accessControlAllowCredentials: true,
    originOverride: true,
  },
});

// Add to the auth behavior:
distribution.addBehavior("/auth/*", auth.authBehavior.origin, {
  ...auth.authBehavior,
  responseHeadersPolicy: corsPolicy,
});
```

## Custom domain

Replace `distribution.distributionDomainName` with your domain name and point an `A`/`ALIAS` DNS record at the distribution:

```ts
const frontendUri = "https://app.example.com";

const auth = new Auth(this, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: true,
});
```

## Tip: keeping Lambdas warm

Pass a `@beesolve/lambda-keep-active` instance to avoid cold starts on auth and API handlers:

```ts
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";

const warmer = new LambdaKeepActive(this, "Warmer");

const auth = new Auth(this, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: true,
  warmer,
});
```
