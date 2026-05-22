# Origin Verification Token

The auth Lambda function URL is publicly reachable. A shared token in the `x-origin-token` header ensures only CloudFront can invoke it — requests without the correct token are rejected with `403 Forbidden`.

## How it works

On first deployment, the `Auth` construct generates a 128-character random secret in AWS Secrets Manager and injects it into the Lambda as the `ORIGIN_TOKEN` environment variable. The Lambda rejects any request where the `x-origin-token` header doesn't match.

You add the same token as a **custom origin header** in your CloudFront distribution. CloudFront attaches it to every request it forwards to the Lambda function URL. Direct invocations (bypassing CloudFront) won't have the header and will be rejected.

## CloudFront configuration

```ts
import { FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AllowedMethods,
  CachePolicy,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";

distribution.addBehavior("/auth/*", new FunctionUrlOrigin(auth.authUrl, {
  customHeaders: {
    "x-origin-token": auth.originVerificationToken,
  },
}), {
  allowedMethods: AllowedMethods.ALLOW_ALL,
  cachePolicy: CachePolicy.CACHING_DISABLED,
  originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
});
```

Use this origin for the `/auth/*` behavior in your CloudFront distribution.

## Why this approach?

- **Zero runtime cost** — the token is resolved at deploy time and baked into both CloudFront and Lambda. No Secrets Manager API calls at runtime.
- **Simple** — no Lambda@Edge, no additional infrastructure.
- **Composable** — works with any CloudFront distribution setup.

### Why not Lambda@Edge + Secrets Manager at runtime?

Reading the token at runtime would require Lambda@Edge on every CloudFront request to attach the header dynamically. This adds:

- **Latency** — Lambda@Edge cold starts on every edge location
- **Cost** — per-invocation charges + Secrets Manager API calls
- **Complexity** — additional Lambda function to maintain

The token protects informational metadata (geo/device headers from CloudFront), not authentication itself. Deploy-time injection is sufficient.

## Rotation

If the token is compromised:

1. Generate a new secret value in Secrets Manager (console or CLI):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id <secret-arn> \
     --secret-string "$(openssl rand -base64 96 | tr -d '/+=' | head -c 128)"
   ```
2. Redeploy the stack so both CloudFront and Lambda pick up the new value.

The secret ARN is visible in the CloudFormation stack outputs or the Secrets Manager console.

## What it protects

Without this token, an attacker who discovers the Lambda function URL can:

- Inject arbitrary `CloudFront-Viewer-*` headers to corrupt session geo/device metadata
- Bypass CloudFront-level protections (WAF rules, rate limiting)

The token ensures the Lambda only processes requests that have passed through your CloudFront distribution.
