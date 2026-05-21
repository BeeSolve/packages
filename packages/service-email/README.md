# @beesolve/email-service

CDK construct and runtime SDK for sending transactional email via AWS SES. Provides an SQS-backed queue for reliable delivery, DynamoDB request tracking, S3 attachment storage, and EventBridge notifications on send success or failure.

## Installation

```bash
npm install @beesolve/email-service
# or
bun add @beesolve/email-service
```

## Exports

| Entry point | Use in | Purpose |
|---|---|---|
| `@beesolve/email-service/cdk` | CDK stack | `Emails` construct — creates all AWS resources |
| `@beesolve/email-service/sdk` | Lambda / server | `Email` class — queues emails for sending |
| `@beesolve/email-service/templating` | Build scripts & Lambda | `renderEmail`, `hydrateTemplate`, `buildTemplates`, `BaseLayout` |
| `@beesolve/email-service/events` | Lambda event handlers | Typed EventBridge event types and helpers |

---

## CDK setup

Add the `Emails` construct to your stack and call `grantAccess` on any Lambda that needs to send email.

```ts
import { Emails } from "@beesolve/email-service/cdk";

const emails = new Emails(this, "Emails", {
  defaultSender: {
    name: "My App",
    emailAddress: "no-reply@example.com",
  },
  isProd: true,
});

// Grants IAM access and injects environment variables automatically
emails.grantAccess(myLambdaFunction);
```

`grantAccess` injects `BEESOLVE_EMAILS_QUEUE_URL`, `BEESOLVE_EMAILS_TABLE_NAME`, and `BEESOLVE_EMAILS_ATTACHMENTS_BUCKET` into the Lambda environment — you never set these manually.

### Construct options

| Option | Default | Description |
|---|---|---|
| `defaultSender` | required | `{ name, emailAddress }` used when no per-request sender is set |
| `fromArn` | — | Restrict sending to a specific SES verified identity ARN |
| `defaultConfigurationSet` | auto-created | Attach an existing SES configuration set |
| `eventsToTrack` | `SEND, BOUNCE, COMPLAINT, DELIVERY, REJECT` | SES events forwarded to EventBridge |
| `messagesRetentionDays` | `14` | How long email requests are kept in DynamoDB (set to `0` to disable) |
| `attachmentsRetentionDays` | `180` | How long attachments are kept in S3 |
| `eventBusName` | `"default"` | EventBridge bus to publish events to |
| `isProd` | `false` | Enables DynamoDB point-in-time recovery |
| `handler` | — | Override `memorySize`, `timeout`, `reservedConcurrentExecutions` for the queue handler Lambda |

---

## Sending an email

```ts
import { Email } from "@beesolve/email-service/sdk";

const email = new Email();

await email.sendEmail({
  recipients: ["alice@example.com"],
  subject: "Welcome!",
  html: "<p>Hello, Alice!</p>",
  text: "Hello, Alice!",
});
```

### With a custom sender

```ts
await email.sendEmail({
  recipients: ["alice@example.com"],
  subject: "Welcome!",
  html: "<p>Hello!</p>",
  text: "Hello!",
  sender: { name: "Support", emailAddress: "support@example.com" },
});
```

### With attachments

```ts
await email.sendEmail({
  recipients: ["alice@example.com"],
  subject: "Your report",
  html: "<p>See attached.</p>",
  text: "See attached.",
  attachments: [
    {
      type: "s3",
      mimeType: "application/pdf",
      body: pdfBuffer,
      customName: "report.pdf",
    },
    {
      type: "public",
      mimeType: "image/png",
      publicUrl: "https://cdn.example.com/logo.png",
      customName: "logo.png",
    },
  ],
});
```

### Retrieving a sent message

```ts
const { requestId } = await email.sendEmail({ ... });

const message = await email.getMessage(requestId);
// message.messageId — SES message ID
// message.request   — original send request
// message.expiresAt — when the record is removed from DynamoDB
```

---

## Email templates

See [docs/react-email-templates.md](docs/react-email-templates.md) for a complete tutorial covering:

- Writing templates with `BaseLayout` and `@react-email/components`
- Why you should always **pre-build** templates (Lambda bundle size)
- Using `buildTemplates()` in your build script
- Using `hydrateTemplate()` at runtime

### Quick example

**Build script (`build.ts`)**

```ts
import { buildTemplates } from "@beesolve/email-service/templating";
import { join } from "node:path";

await buildTemplates({
  templatesDir: join(__dirname, "src/templates"),
  outDir: join(__dirname, "build"),
  locales: ["en", "fr"],
});
```

**Template (`src/templates/welcome.tsx`)**

```tsx
import { BaseLayout } from "@beesolve/email-service/templating";
import { Button, Text } from "@react-email/components";

interface Props {
  name: string;
  baseUri: string;
}

export default function WelcomeEmail({ name, baseUri }: Props) {
  return (
    <BaseLayout
      previewText={`Welcome, ${name}`}
      project={{ name: "My App", baseUri }}
    >
      {(styles) => (
        <>
          <Text style={styles.text}>Hi {name}, welcome aboard!</Text>
          <Button href={`${baseUri}/app`} style={styles.button}>
            Open app
          </Button>
        </>
      )}
    </BaseLayout>
  );
}

WelcomeEmail.PreviewProps = {
  name: "Alice",
  baseUri: "https://example.com",
};
```

**Lambda handler**

```ts
import { hydrateTemplate } from "@beesolve/email-service/templating";
import { Email } from "@beesolve/email-service/sdk";
import welcomeEn from "./build/welcome_en.json";

const emailClient = new Email();

const { subject, html, text } = hydrateTemplate({
  template: welcomeEn,
  subject: "Welcome!",
  props: { name: user.name, baseUri: process.env.BASE_URI! },
});

await emailClient.sendEmail({ recipients: [user.email], subject, html, text });
```

---

## EventBridge events

See [docs/eventbridge-events.md](docs/eventbridge-events.md) for a complete tutorial.

The service publishes two families of events to EventBridge:

| Source | `detail-type` | When |
|---|---|---|
| `beesolve.email.api` | `EmailSentSuccess` | SES accepted and sent the message |
| `beesolve.email.api` | `EmailSentFailure` | The queue handler failed to send |
| `aws.ses` | `SES Delivery` | Recipient's mail server confirmed delivery |
| `aws.ses` | `SES Bounce` | Hard or soft bounce |
| `aws.ses` | `SES Complaint` | Recipient reported spam |
| `aws.ses` | `SES Message Sent` | SES accepted the message for sending |
| `aws.ses` | `SES Reject` | SES rejected the message |

Use the typed helpers from `@beesolve/email-service/events`:

```ts
import { parseEmailEvent, isSesDelivery, isSesBounce } from "@beesolve/email-service/events";
import type { SQSEvent } from "aws-lambda";

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const emailEvent = parseEmailEvent(record.body);
    if (!emailEvent) continue;

    if (isSesDelivery(emailEvent)) {
      console.log("Delivered to", emailEvent.detail.delivery.recipients);
    }

    if (isSesBounce(emailEvent)) {
      const bounced = emailEvent.detail.bounce.bouncedRecipients.map((r) => r.emailAddress);
      console.log("Bounced:", bounced);
    }
  }
};
```

---

## FAQ

**Can I send to multiple recipients?**
Yes — pass an array to `recipients`. Each address is normalised to lowercase automatically.

**What happens if the Lambda fails to send?**
The SQS message is retried (with the dead-letter queue as a safety net) and an `EmailSentFailure` event is published to EventBridge.

**Are environment variables set automatically?**
Yes. `grantAccess(lambda)` grants the necessary IAM permissions and injects all three required env vars (`BEESOLVE_EMAILS_QUEUE_URL`, `BEESOLVE_EMAILS_TABLE_NAME`, `BEESOLVE_EMAILS_ATTACHMENTS_BUCKET`) — you do not configure them yourself.

**How do I disable DynamoDB message persistence?**
Pass `messagesRetentionDays: 0` to the `Emails` construct. The `getMessage()` SDK method will not be usable in that case.

**Why shouldn't I import react-email templates directly in my Lambda?**
Bundling React, react-dom, and all `@react-email/*` packages into a Lambda significantly inflates bundle size and cold-start time. The pre-build pattern (rendering to static JSON at deploy time) eliminates this: your Lambda ships only the pre-rendered HTML/text strings and calls `hydrateTemplate()` to fill in runtime values. See [docs/react-email-templates.md](docs/react-email-templates.md).

**Can I use a custom SES configuration set?**
Yes. Pass `defaultConfigurationSet` to the construct. You can also override per-send by passing `configurationSetName` to `sendEmail()`.
