# How to: Set Up a Static Website with CloudFront

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi

The `StaticWebsite` construct provisions a private S3 bucket, a CloudFront distribution with security headers (CSP, HSTS, X-Frame-Options), and the bucket deployment that uploads your build output. It supports single-page and multi-page apps, an optional custom domain, and optional basic auth.

## Prerequisites

- An AWS CDK v2 app
- A built site in a local directory (e.g. `dist/`)
- For a custom domain: an ACM certificate in `us-east-1` and a Route 53 hosted zone for the domain

## Steps

### 1. Install

```sh
bun add @beesolve/cdk-constructs
```

### 2. Deploy a single-page application

`refererId` is a shared secret placed in the CloudFront origin request header and the S3 bucket policy - use a long random string. It must be non-empty and must not contain `*` or `?`.

```ts
import { StaticWebsite } from "@beesolve/cdk-constructs";
import { Source } from "aws-cdk-lib/aws-s3-deployment";

const site = new StaticWebsite(this, "Site", {
  mode: "singlePageApplication",
  source: Source.asset("dist"),
  refererId: "a3f8-long-random-secret-c9d2",
  contentSecurityPolicy: {
    connectSrc: ["https://api.example.com"],
    scriptSrc: ["'self'"],
  },
});
```

The distribution URL is emitted as a `CfnOutput` named `DistributionUrl`, and `site.distribution` exposes the underlying CloudFront `Distribution` for adding behaviors.

### 3. Add a custom domain

Provide the bare domain name and a certificate (ARN string or `Certificate`). DNS A records for both the apex and `www` are created in Route 53 by default; set `createDnsRecords: false` to manage them yourself.

```ts
new StaticWebsite(this, "Site", {
  mode: "singlePageApplication",
  source: Source.asset("dist"),
  refererId: "a3f8-long-random-secret-c9d2",
  contentSecurityPolicy: { connectSrc: ["'self'"] },
  domain: {
    name: "example.com",
    certificate: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
    redirect: "enforceNonWww",
  },
});
```

### 4. Protect the site with basic auth

```ts
new StaticWebsite(this, "Site", {
  mode: "singlePageApplication",
  source: Source.asset("dist"),
  refererId: "a3f8-long-random-secret-c9d2",
  contentSecurityPolicy: { connectSrc: ["'self'"] },
  basicHttpAuthentication: {
    username: "admin",
    password: "secret",
    prefixes: ["/"],
  },
});
```

### 5. Capture CloudFront access logs

Pair it with `CloudFrontAccessLoggingSettings` and pass its `cloudFrontLoggingSettings` to the `logging` prop.

```ts
import { CloudFrontAccessLoggingSettings, StaticWebsite } from "@beesolve/cdk-constructs";

const logging = new CloudFrontAccessLoggingSettings(this, "Logging", {
  logFilePrefix: "cf-logs/",
});

new StaticWebsite(this, "Site", {
  mode: "singlePageApplication",
  source: Source.asset("dist"),
  refererId: "a3f8-long-random-secret-c9d2",
  contentSecurityPolicy: { connectSrc: ["'self'"] },
  logging: logging.cloudFrontLoggingSettings,
});
```

## Common Pitfalls

- An empty `refererId`, or one containing `*` or `?`, throws at synth time - the wildcard check prevents unintended public S3 access.
- The ACM certificate for a CloudFront custom domain must be in `us-east-1`, regardless of your stack region.
- `connectSrc` defaults to `'none'`, so XHR/fetch calls are blocked until you list your API origins in `contentSecurityPolicy`.
- With a custom domain and default DNS, the hosted zone for `domain.name` must already exist in the account - `HostedZone.fromLookup` fails otherwise.

## See Also

- [Getting started](./getting-started.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi)
