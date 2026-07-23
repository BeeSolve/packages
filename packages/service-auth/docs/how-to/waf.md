# WAF Rate Limiting

The `AuthGateway` and `AuthService` constructs can optionally create a WAF rule group for rate limiting requests to the auth endpoints. This is disabled by default due to additional AWS WAF costs.

## Why a rule group instead of a full WebACL?

A CloudFront distribution can only have **one WebACL** attached. Most production setups already have a WAF in place with custom rules (bot protection, geo-blocking, etc.). Creating a second WebACL would conflict with the existing one.

Instead, the construct creates a **rule group** — a reusable set of rules that you reference from your existing WebACL. This is composable: you add it alongside your other rules without replacing anything.

## Enabling WAF

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";

const auth = new AuthGateway(this, "Auth", {
  stage: "prod",
  frontendUri: "https://app.example.com",
  allowSignUp: true,
  waf: { rateLimit: 100 }, // 100 requests per 5-minute window per IP
});
```

When `waf` is provided, `auth.wafRuleGroup` is set to the created `CfnRuleGroup`.

## Adding to an existing WebACL

If you already have a WebACL on your CloudFront distribution, reference the rule group:

```ts
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

new CfnWebACL(this, "MyWebAcl", {
  defaultAction: { allow: {} },
  scope: "CLOUDFRONT",
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: "my-web-acl",
    sampledRequestsEnabled: true,
  },
  rules: [
    // Your existing rules...
    {
      name: "AuthRateLimit",
      priority: 10,
      statement: {
        ruleGroupReferenceStatement: {
          arn: auth.wafRuleGroup!.attrArn,
        },
      },
      overrideAction: { none: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "auth-rate-limit",
        sampledRequestsEnabled: true,
      },
    },
  ],
});
```

## Creating a new WebACL (minimal example)

If you don't have a WAF yet, create one and attach it to your CloudFront distribution:

```ts
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

const webAcl = new CfnWebACL(this, "WebAcl", {
  defaultAction: { allow: {} },
  scope: "CLOUDFRONT",
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: "web-acl",
    sampledRequestsEnabled: true,
  },
  rules: [
    {
      name: "AuthRateLimit",
      priority: 1,
      statement: {
        ruleGroupReferenceStatement: {
          arn: auth.wafRuleGroup!.attrArn,
        },
      },
      overrideAction: { none: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "auth-rate-limit",
        sampledRequestsEnabled: true,
      },
    },
  ],
});

new Distribution(this, "Cdn", {
  webAclId: webAcl.attrArn,
  // ...other distribution config
});
```

> **Note:** WAF for CloudFront must be deployed in `us-east-1`. If your stack is in another region, you'll need a cross-region reference or deploy the WAF resources in a separate `us-east-1` stack.

## Rate limit behavior

The rule blocks an IP address for the remainder of the 5-minute evaluation window once it exceeds the configured `rateLimit` (default: 100 requests). After the window resets, the IP is unblocked automatically.

This protects against:

- OTP email flooding (spamming `/signInRequest`)
- Brute-force attempts on `/signInComplete`
- General abuse of the public auth endpoints
