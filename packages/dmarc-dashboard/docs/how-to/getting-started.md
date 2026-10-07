# How to: Get started with the DMARC dashboard

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports

## Prerequisites

- A deployed `@beesolve/dmarc-reports` ingestion pipeline
- A deployed `@beesolve/dmarc-consumer` (the dashboard reads its DynamoDB table)
- `@beesolve/auth-service` for email-code sign-in
- A CDK app (`aws-cdk-lib` + `constructs`), SES configured in the region

## Steps

### 1. Install

```sh
bun add @beesolve/dmarc-dashboard @beesolve/dmarc-reports @beesolve/dmarc-consumer @beesolve/auth-service
```

```sh
npm install @beesolve/dmarc-dashboard @beesolve/dmarc-reports @beesolve/dmarc-consumer @beesolve/auth-service
```

### 2. Wire the pipeline, then the dashboard

Only `./cdk` is exported. Build ingestion, consumer, and auth, then pass the
consumer and auth to `DmarcDashboard`. `FRONTEND_URI` is the CloudFront URL.

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";
import { DmarcDashboard } from "@beesolve/dmarc-dashboard/cdk";
import { DmarcReports } from "@beesolve/dmarc-reports/cdk";

new DmarcReports(stack, "DmarcReports", { recipient: "rua@dmarc.example.com" });
const consumer = new DmarcConsumer(stack, "DmarcConsumer");

const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri: process.env.FRONTEND_URI!,
  allowSignUp: false,
  authorizerCache: "disabled",
});

new DmarcDashboard(stack, "DmarcDashboard", {
  auth,
  consumer,
  emailSender: { name: "DMARC Dashboard", emailAddress: "noreply@example.com" },
});
```

### 3. Deploy

```sh
bunx cdk deploy
```

The dashboard serves a SvelteKit app on Lambda behind CloudFront, enforces the
auth cookie, and shows per-domain pass/fail stats and paginated report timelines.

## Common Pitfalls

- First deploy is chicken-and-egg: set `FRONTEND_URI` to a placeholder, deploy, then redeploy with the real CloudFront URL.
- The dashboard renders nothing useful until `@beesolve/dmarc-consumer` has persisted reports — deploy ingestion and consumer first.
- Source-IP ASN/country columns show `—` until you configure an ipinfo.io key (see the README).

## See Also

- [README](../../README.md) — architecture, construct props, local development
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports)
