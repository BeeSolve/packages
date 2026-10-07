# How to: Get started with the email service dashboard

> Full source: https://github.com/BeeSolve/packages/tree/main/packages/service-email-dashboard

## Prerequisites

- A deployed `@beesolve/email-service` (the dashboard projects its EventBridge delivery events)
- `@beesolve/auth-service` for email-code sign-in
- A CDK app (`aws-cdk-lib` + `constructs`), SES configured in the deployment region

## Steps

### 1. Install

```sh
bun add @beesolve/email-service-dashboard @beesolve/auth-service @beesolve/email-service
```

```sh
npm install @beesolve/email-service-dashboard @beesolve/auth-service @beesolve/email-service
```

### 2. Build an AuthGateway, then the dashboard

Only the `./cdk` entry is exported. Construct an `AuthGateway` first and hand it to
`EmailServiceDashboard`. `FRONTEND_URI` is the CloudFront URL (see first-deploy note).

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { EmailServiceDashboard } from "@beesolve/email-service-dashboard/cdk";

const auth = new AuthGateway(stack, "Auth", {
  stage: "prod",
  frontendUri: process.env.FRONTEND_URI!,
  allowSignUp: false,
  authorizerCache: "disabled",
});

new EmailServiceDashboard(stack, "Dashboard", {
  auth,
  emailSender: { name: "Email Dashboard", emailAddress: "noreply@example.com" },
});
```

The construct provisions its own DynamoDB projection table, the SvelteKit app on
Lambda behind CloudFront, an OTP email sender, and an event-ingest Lambda that
reads delivery events off the account `default` bus.

### 3. Deploy

```sh
bunx cdk deploy
```

The dashboard builds its sent-log projection from the delivery lifecycle
(`EmailSentSuccess` / `EmailSentFailure` plus SES bounce / complaint / delivery
events) — it never reads the email service's own storage.

## Common Pitfalls

- First deploy is chicken-and-egg: set `FRONTEND_URI` to a placeholder, deploy, then redeploy with the real CloudFront URL.
- SES configuration-set event destinations can only target the account `default` bus, so the delivery-events rule is always bound there (the dashboard has no `eventBusName` prop).
- For local dev, set `DEV_USER_EMAIL` to a real user so the faked session resolves a role.

## See Also

- [README](../../README.md) — architecture, construct props, and local development
- [@beesolve/email-service](https://github.com/BeeSolve/packages/tree/main/packages/service-email) — the service whose events this dashboard projects
