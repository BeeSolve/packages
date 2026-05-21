# CloudFront CDK example

This example shows a complete CDK stack that places a CloudFront distribution in front of both the auth endpoints and an application API, all on the same domain.

## Why same-domain matters

`__Host-SID` and `__Host-DataToken` are `__Host-` prefixed cookies. Browsers only send them to the exact origin that set them — there is no `Domain` attribute, so they cannot be shared across subdomains. By routing `/auth/*`, `/api/*`, and the frontend through a single CloudFront distribution, every request shares the same origin and cookies flow automatically without any manual token handling in your frontend code.

## Stack

```ts
import { Auth } from "@beesolve/auth-service/cdk";
import { Fn, Stack, type StackProps } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import {
  FunctionUrlOrigin,
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

    // Create distribution first so we can pass its domain to Auth.
    // If you have a custom domain, pass that instead and point your DNS
    // record at the distribution after it is deployed.
    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(frontendBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    const frontendUri = `https://${distribution.distributionDomainName}`;

    // --- Auth ------------------------------------------------------------
    // frontendUri MUST match the CloudFront domain (or custom domain) so that
    // __Host-* cookies are scoped to the same origin as the rest of the app.
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

    // Adds the Lambda behind the session-cookie authorizer on auth.api
    auth.addAuthorizedEndpoint({ lambda: apiHandler });

    // --- CloudFront behaviors --------------------------------------------
    const passthroughBehavior = {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      // Forwards all viewer headers and query strings except the Host header,
      // which CloudFront replaces with the origin domain. This ensures cookies
      // are forwarded to the Lambda and API Gateway unchanged.
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    };

    // /auth/* → Lambda function URL (signInRequest, signInComplete, signOut)
    distribution.addBehavior(
      "/auth/*",
      new FunctionUrlOrigin(auth.authUrl),
      passthroughBehavior,
    );

    // /api/* → API Gateway HTTP API (session-protected routes)
    distribution.addBehavior(
      "/api/*",
      new HttpOrigin(Fn.parseDomainName(auth.api.url!)),
      passthroughBehavior,
    );
  }
}
```

## What each piece does

| Behavior | Origin | Purpose |
|---|---|---|
| `/*` (default) | S3 bucket | Serves your frontend SPA |
| `/auth/*` | `FunctionUrlOrigin(auth.authUrl)` | Auth handler — sets `__Host-SID` and `aSID` cookies |
| `/api/*` | `HttpOrigin(auth.api.url)` | API Gateway — the Lambda authorizer validates `__Host-SID` on every request |

## Custom domain

Replace `distribution.distributionDomainName` with your domain name and point an `A`/`ALIAS` DNS record at the distribution. Pass the same domain as `frontendUri`:

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
