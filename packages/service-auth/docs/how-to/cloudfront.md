# How to: Put the auth service behind CloudFront

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi

This example shows a complete CDK stack that places a CloudFront distribution in front of both the auth endpoints and an application API, all on the same domain.

## Why same-domain matters

`__Host-SID` and `__Host-DataToken` are `__Host-` prefixed cookies. Browsers only send them to the exact origin that set them — there is no `Domain` attribute, so they cannot be shared across subdomains. By routing `/auth/*`, `/api/*`, and the frontend through a single CloudFront distribution, every request shares the same origin and cookies flow automatically without any manual token handling in your frontend code.

## Stack (SPA with API Gateway)

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { Fn } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3StaticWebsiteOrigin } from "aws-cdk-lib/aws-cloudfront-origins";

const distribution = new Distribution(this, "Distribution", {
  defaultBehavior: {
    origin: new S3StaticWebsiteOrigin(frontendBucket),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
});

const auth = new AuthGateway(this, "Auth", {
  stage: "prod",
  frontendUri: `https://${distribution.distributionDomainName}`,
  allowSignUp: true,
});

auth.addAuthorizedEndpoint({ lambda: apiHandler }); // defaults to /api/{proxy+}

distribution.addBehavior("/auth/*", auth.authBehavior.origin, auth.authBehavior);
distribution.addBehavior("/api/*", new HttpOrigin(Fn.parseDomainName(auth.api.url!)), {
  allowedMethods: AllowedMethods.ALLOW_ALL,
  cachePolicy: CachePolicy.CACHING_DISABLED,
  originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
});
```

## What each piece does

| Behavior       | Origin                     | Purpose                                                                     |
| -------------- | -------------------------- | --------------------------------------------------------------------------- |
| `/*` (default) | S3 bucket                  | Serves your frontend SPA                                                    |
| `/auth/*`      | `auth.authBehavior`        | Auth handler — OAC-signed, Lambda@Edge computes body hash for SigV4         |
| `/api/*`       | `HttpOrigin(auth.api.url)` | API Gateway — the Lambda authorizer validates `__Host-SID` on every request |

## How OAC works

CloudFront Origin Access Control (OAC) signs requests to the Lambda function URL using SigV4. The function URL has `AuthType: AWS_IAM`, so direct access (without a valid SigV4 signature) is rejected at the IAM layer — the Lambda is never invoked.

For POST requests, SigV4 requires the body hash (`x-amz-content-sha256`). A Lambda@Edge function (origin-request, `includeBody: true`) computes this header automatically. This is already wired into `auth.authBehavior`.

## Cross-stack usage

When the CloudFront distribution lives in a different stack, use `createAuthBehavior(scope)` to avoid CloudFormation cross-stack export issues with Lambda@Edge version ARNs:

```ts
const behavior = auth.createAuthBehavior(this);
distribution.addBehavior("/auth/*", behavior.origin, behavior);
```

## Custom domain

Replace `distribution.distributionDomainName` with your domain name and point an `A`/`ALIAS` DNS record at the distribution:

```ts
const frontendUri = "https://app.example.com";

const auth = new AuthGateway(this, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: true,
});
```

## Keeping Lambdas warm

Pass a `@beesolve/lambda-keep-active` instance to avoid cold starts on auth and API handlers:

```ts
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";

const warmer = new LambdaKeepActive(this, "Warmer");

const auth = new AuthGateway(this, "Auth", {
  stage: "prod",
  frontendUri,
  allowSignUp: true,
  warmer,
});
```

## Common Pitfalls

- **Splitting auth and app across subdomains.** `__Host-SID` and `__Host-DataToken` have no `Domain` attribute, so the browser only sends them to the exact origin that set them. Route `/auth/*`, `/api/*`, and the frontend through one distribution; subdomains silently break cookie flow.
- **Caching the `/api/*` behavior.** Session-protected API responses must use `CachePolicy.CACHING_DISABLED` and `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`, otherwise CloudFront strips or caches the cookie and the authorizer never sees it.
- **Cross-stack behaviors.** When the distribution lives in a different stack than the auth construct, use `auth.createAuthBehavior(scope)` instead of `auth.authBehavior` to avoid CloudFormation cross-stack export issues with the Lambda@Edge version ARN.
- **WAF in the wrong region.** WAF for CloudFront must be deployed in `us-east-1`. See the [WAF guide](./waf.md).

## See Also

- [Getting Started](./getting-started.md) - install through first deployment
- [WAF rate limiting](./waf.md) - protect the public auth endpoints
- [Full SPA + API example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi)
- [Minimal SSR example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple)
