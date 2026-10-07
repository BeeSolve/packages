# How to: Get started with auth-service

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple

Deploy passwordless email-code auth into your AWS account and wire a SvelteKit app to it. This covers install, CDK setup, SvelteKit session resolution, and first deployment.

## Prerequisites

- An AWS account and CDK bootstrapped in the target region
- A SvelteKit app deployed via `kit-on-lambda` (the sample uses this)
- An EventBridge consumer that sends the OTP email (the auth service only emits the event)

## Steps

### 1. Install

```sh
bun add @beesolve/auth-service
# or: npm install @beesolve/auth-service
```

### 2. Add the AuthGateway construct

```ts
import { AuthGateway } from "@beesolve/auth-service/cdk";

const auth = new AuthGateway(this, "Auth", {
  stage: "dev",
  frontendUri: process.env.FRONTEND_URI!,
  allowSignUp: true,
});

auth.addPublicEndpoint({ lambda: handler });
auth.grantSessionAccess(handler);
auth.grantSdkAccess(handler);

const authBehavior = auth.createAuthBehavior(distribution);
distribution.addBehavior("/auth/*", authBehavior.origin, authBehavior);
```

### 3. Resolve sessions in SvelteKit hooks

The in-process pattern resolves the session from DynamoDB directly - no authorizer Lambda, one invocation per request.

```ts
// hooks.server.ts
import { createInProcessSessionHandle } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

const publicPaths = new Set(["/sign-in", "/sign-in/verify"]);

const authGuard: Handle = async ({ event, resolve }) => {
  if (event.locals.session.type !== "valid" && !publicPaths.has(event.url.pathname)) {
    redirect(303, "/sign-in");
  }
  return resolve(event);
};

export const handle = sequence(createInProcessSessionHandle(), authGuard);
```

### 4. Send the OTP email

Subscribe a Lambda to the `EmailCodeAuth` event and send the code. See [Consuming auth events](./consuming-events.md).

### 5. Deploy

```sh
bun run cdk deploy
```

First deployment is chicken-and-egg: `frontendUri` needs the CloudFront URL, which does not exist until the first deploy. Set a placeholder, deploy, read the CloudFront URL from the CDK output, then redeploy with the real value.

## See Also

- [Consuming auth events](./consuming-events.md) - send the OTP email
- [Put the auth service behind CloudFront](./cloudfront.md) - full SPA + API topology
- [Local development](./local-development-with-kit-on-lambda.md) - run it on your machine
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple)
