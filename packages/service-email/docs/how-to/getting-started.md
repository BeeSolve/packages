# How to: Get started with the email service

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithEmail

## Prerequisites

- An AWS account with a verified SES sending identity (domain or email address)
- A CDK app (`aws-cdk-lib` + `constructs`)
- Node.js 24+

## Steps

### 1. Install

```sh
bun add @beesolve/email-service
```

```sh
npm install @beesolve/email-service
```

### 2. Deploy the construct

Provision SQS, S3, SES configuration, and the queue-processing Lambda, then grant
access to the Lambda that will send email. `grantAccess` injects the env vars the
SDK needs — you never set them manually.

```ts
import { Emails } from "@beesolve/email-service/cdk";

const emails = new Emails(this, "Emails", {
  defaultSender: { name: "My App", emailAddress: "no-reply@example.com" },
});

emails.grantAccess(mySenderLambda);
```

### 3. Send an email from your Lambda

```ts
import { Email } from "@beesolve/email-service/sdk";

const email = new Email();

const { requestId } = await email.sendEmail({
  recipients: ["alice@example.com"],
  subject: "Welcome!",
  html: "<p>Hello, Alice!</p>",
  text: "Hello, Alice!",
});
```

The SDK queues the message to SQS and returns a `requestId`; the handler Lambda
sends it via SES.

### 4. React to delivery outcomes (optional)

The service emits lifecycle events to EventBridge. Parse them in a consumer Lambda:

```ts
import { parseEmailEvent, isSesBounce } from "@beesolve/email-service/events";

const emailEvent = parseEmailEvent(record.body);
if (emailEvent != null && isSesBounce(emailEvent)) {
  console.warn("Bounced", emailEvent.detail.bounce.bouncedRecipients);
}
```

## Common Pitfalls

- New AWS accounts are in the SES sandbox and can only send to verified addresses until you request production access.
- Call `emails.grantAccess(lambda)` or the SDK throws because `BEESOLVE_EMAILS_QUEUE_URL` / `BEESOLVE_EMAILS_ATTACHMENTS_BUCKET` are unset.
- This service keeps no sent log; deploy `@beesolve/email-service-dashboard` if you need a queryable UI.

## See Also

- [README](../../README.md) — full API, templating, and EventBridge reference
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithEmail)
