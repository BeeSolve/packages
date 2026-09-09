# @beesolve/email-service

CDK construct and runtime SDK for sending transactional email via AWS SES.

- SQS-backed queue for reliable delivery with automatic retries and DLQ
- S3 attachment storage (supports both uploaded buffers and public URLs)
- EventBridge notifications on send success/failure and SES delivery events
- Pre-built React email templating (no React in your Lambda bundle)
- Typed EventBridge event helpers with Valibot-validated parsing

## What This Is

A turnkey email infrastructure package. Deploy the CDK construct, call `grantAccess` on your Lambda, and send emails via the SDK. The construct provisions SQS, S3, SES configuration, and the queue-processing Lambda — you don't manage any of that directly.

## What This Is NOT

- Not a marketing/bulk email service — designed for transactional email (welcome emails, notifications, receipts)
- Not a template design tool — use `@react-email/components` for authoring and `bunx email dev` for previewing
- Not an email receiving service — only handles outbound sending
- Does not manage SES domain/identity verification — you must verify your sending domain separately in SES
- Not a sent-message store — this service does not persist messages. It emits EventBridge events; use the dashboard (below) or your own consumer to build a queryable log.

## Delivery observability & the dashboard

This service intentionally keeps no database. It emits the delivery lifecycle
(`EmailSentSuccess` / `EmailSentFailure` plus SES bounce/complaint/delivery events) to
EventBridge, and that is the single integration point for anything that wants to observe
sending.

If you want a queryable sent log with a UI — messages by month, per-recipient history,
aggregate counters, and per-recipient delivery timelines — deploy
[`@beesolve/email-service-dashboard`](../service-email-dashboard). The dashboard runs its
own event-ingest Lambda that projects these EventBridge events into its **own** DynamoDB
table and stores request bodies in its **own** S3 bucket. It never reads from this
service's storage — the two stay decoupled through events.

> **Note:** Earlier versions of this package persisted every send to a DynamoDB table and
> exposed a `getMessage()` SDK method. That was removed once the dashboard took over the
> sent-log role. See [`docs/adr-002-drop-dynamodb-message-persistence.md`](./docs/adr-002-drop-dynamodb-message-persistence.md).

## Installation

```bash
npm install @beesolve/email-service
```

```bash
bun add @beesolve/email-service
```

## CDK Setup

```ts
import { Emails } from "@beesolve/email-service/cdk";

const emails = new Emails(this, "Emails", {
  defaultSender: {
    name: "My App",
    emailAddress: "no-reply@example.com",
  },
});

// Grants IAM permissions and injects env vars automatically
emails.grantAccess(myLambdaFunction);
```

`grantAccess` injects `BEESOLVE_EMAILS_QUEUE_URL` and `BEESOLVE_EMAILS_ATTACHMENTS_BUCKET` into the Lambda environment. You never set these manually.

### Construct Props

| Prop                       | Default                                                              | Description                                                     |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `defaultSender`            | required                                                             | `{ name, emailAddress }` used when no per-request sender is set |
| `fromArn`                  | —                                                                    | Restrict sending to a specific SES verified identity ARN        |
| `defaultConfigurationSet`  | auto-created                                                         | Attach an existing SES configuration set                        |
| `eventsToTrack`            | `SEND, BOUNCE, COMPLAINT, DELIVERY, REJECT`                          | SES events forwarded to EventBridge                             |
| `attachmentsRetentionDays` | `180`                                                                | How long attachments are kept in S3                             |
| `eventBusName`             | `"default"`                                                          | EventBridge bus to publish events to                            |
| `handler`                  | `{ memorySize: 256, timeout: 30s, reservedConcurrentExecutions: 2 }` | Override Lambda handler settings                                |
| `logGroupProps`            | `{ removalPolicy: DESTROY, retention: TWO_WEEKS }`                   | CloudWatch log group settings for the handler                   |

## Usage

### Sending an email

```ts
import { Email } from "@beesolve/email-service/sdk";

const email = new Email();

const { requestId } = await email.sendEmail({
  recipients: ["alice@example.com"], // normalised to lowercase automatically
  subject: "Welcome!",
  html: "<p>Hello, Alice!</p>",
  text: "Hello, Alice!", // optional plain-text fallback
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

### With reply-to addresses

Use `replyToAddresses` to set where replies are directed when the recipient hits "reply" in their email client. Unlike `sender`, these addresses do **not** need to be verified in SES.

```ts
await email.sendEmail({
  recipients: ["alice@example.com"],
  subject: "Welcome!",
  html: "<p>Hello!</p>",
  text: "Hello!",
  replyToAddresses: ["support@example.com"], // normalised to lowercase automatically
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
      type: "s3", // uploaded to S3, fetched by the handler at send time
      mimeType: "application/pdf",
      body: pdfBuffer,
      customName: "report.pdf",
    },
    {
      type: "public", // fetched from URL by the handler at send time
      mimeType: "image/png",
      publicUrl: "https://cdn.example.com/logo.png",
      customName: "logo.png",
    },
  ],
});
```

### Overriding the SES configuration set per-send

```ts
await email.sendEmail({
  recipients: ["alice@example.com"],
  subject: "Hello",
  html: "<p>Hi</p>",
  configurationSetName: "my-custom-config-set",
});
```

### Custom SDK clients

```ts
import { Email } from "@beesolve/email-service/sdk";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

const email = new Email({
  s3Client: new S3Client({ region: "eu-west-1" }),
  sqsClient: new SQSClient({ region: "eu-west-1" }),
});
```

## Email Templates

Templates use React Email components, pre-rendered at build time to avoid shipping React in your Lambda.

### Writing a template

```tsx
// src/templates/welcome.tsx
import { BaseLayout } from "@beesolve/email-service/templating";
import { Button, Heading, Text } from "@react-email/components";

interface Props {
  name: string;
  baseUri: string;
  locale: string;
}

export default function WelcomeEmail({ name, baseUri }: Props) {
  return (
    <BaseLayout previewText={`Welcome, ${name}`} project={{ name: "My App", baseUri }}>
      {(styles) => (
        <>
          <Heading style={styles.h1}>Welcome aboard!</Heading>
          <Text style={styles.text}>Hi {name}, your account is ready.</Text>
          <Button href={`${baseUri}/app`} style={styles.button}>
            Open app
          </Button>
        </>
      )}
    </BaseLayout>
  );
}

// Keys here become $$$__KEY__$$$ placeholders in the pre-built output
WelcomeEmail.PreviewProps = {
  name: "Alice",
  baseUri: "https://example.com",
  locale: "en",
};
```

### Build script

```ts
// build.ts
import { buildTemplates } from "@beesolve/email-service/templating";
import { join } from "node:path";

await buildTemplates({
  templatesDir: join(__dirname, "src/templates"),
  outDir: join(__dirname, "build"), // produces welcome_en.json, welcome_fr.json, etc.
  locales: ["en", "fr"],
});
```

### Hydrating at runtime

```ts
import { hydrateTemplate } from "@beesolve/email-service/templating";
import { Email } from "@beesolve/email-service/sdk";
import welcomeEn from "./build/welcome_en.json";

const emailClient = new Email();

const { subject, html, text } = hydrateTemplate({
  template: welcomeEn, // pre-built { html, text } with $$$__KEY__$$$ placeholders
  subject: "Welcome!",
  props: { name: user.name, baseUri: process.env.BASE_URI! },
});

await emailClient.sendEmail({ recipients: [user.email], subject, html, text });
```

### `BaseLayout` props

| Prop                   | Required | Description                                               |
| ---------------------- | -------- | --------------------------------------------------------- |
| `previewText`          | yes      | Short preview text shown in email clients                 |
| `project.name`         | yes      | Used in the header and footer                             |
| `project.baseUri`      | yes      | Base URL for links                                        |
| `project.logo`         | no       | ReactNode to replace the text name in the header          |
| `children`             | yes      | Function receiving the style object, returns body content |
| `notice`               | no       | Override the default security notice in the footer        |
| `notificationSettings` | no       | Override the notification settings footer                 |
| `enhanceStyles`        | no       | Extend the default style object with custom tokens        |

### Previewing locally

```bash
bunx email dev --dir src/templates
```

Opens a browser at `http://localhost:3000` to preview templates with their `PreviewProps`.

## EventBridge Events

The service publishes events from two sources:

| Source               | `detail-type`      | When                                       |
| -------------------- | ------------------ | ------------------------------------------ |
| `beesolve.email.api` | `EmailSentSuccess` | SES accepted and sent the message          |
| `beesolve.email.api` | `EmailSentFailure` | The queue handler failed to send           |
| `aws.ses`            | `SES Delivery`     | Recipient's mail server confirmed delivery |
| `aws.ses`            | `SES Bounce`       | Hard or soft bounce                        |
| `aws.ses`            | `SES Complaint`    | Recipient reported spam                    |
| `aws.ses`            | `SES Message Sent` | SES accepted the message for sending       |
| `aws.ses`            | `SES Reject`       | SES rejected the message                   |

### Handling events

```ts
import {
  parseEmailEvent,
  isEmailSentSuccess,
  isSesBounce,
  isSesComplaint,
  isSesDelivery,
} from "@beesolve/email-service/events";
import type { SQSEvent } from "aws-lambda";

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const emailEvent = parseEmailEvent(record.body); // returns null for unrecognised events
    if (!emailEvent) continue;

    if (isEmailSentSuccess(emailEvent)) {
      console.log("Sent", emailEvent.detail.requestId, emailEvent.detail.messageId);
    }

    if (isSesBounce(emailEvent)) {
      const bounced = emailEvent.detail.bounce.bouncedRecipients.map((r) => r.emailAddress);
      console.warn("Bounced:", bounced);
    }

    if (isSesComplaint(emailEvent)) {
      const addresses = emailEvent.detail.complaint.complainedRecipients.map((r) => r.emailAddress);
      console.warn("Complaint from", addresses);
    }

    if (isSesDelivery(emailEvent)) {
      console.log("Delivered to", emailEvent.detail.delivery.recipients);
    }
  }
};
```

### Correlating events

`EmailSentSuccess` includes both `requestId` (from the SDK) and `messageId` (from SES). SES events carry the same `messageId` in `detail.mail.messageId`. Join on `messageId` to correlate your send request with downstream delivery/bounce events.

## Caveats & Constraints

- **SES sandbox**: New AWS accounts start in the SES sandbox. You can only send to verified addresses until you request production access.
- **Attachment size limit**: 25 MB per attachment (binary). The SES raw message limit is 40 MB post-base64 encoding.
- **Public URL attachments**: Fetched by the handler Lambda with a 10-second timeout. Ensure URLs are accessible from the Lambda's network.
- **Recipient validation**: Email addresses are validated with Valibot and normalised to lowercase. Invalid addresses cause the SQS message to fail.
- **Single region**: The construct deploys to one region. SES must be configured in that region.

## Troubleshooting

**"It seems that Emails service has not been set up correctly"**
The SDK validates that `BEESOLVE_EMAILS_QUEUE_URL` and `BEESOLVE_EMAILS_ATTACHMENTS_BUCKET` are present in `process.env`. Ensure you called `emails.grantAccess(yourLambda)` in CDK.

**Emails are queued but never sent**
Check the queue handler Lambda's CloudWatch logs. Common causes: SES identity not verified, SES sandbox restrictions, or the handler Lambda doesn't have `ses:SendEmail` permission (should be granted automatically by the construct).

**`EmailSentFailure` events appearing**
The handler Lambda failed to process the message. Check logs for the specific error. The SQS message will retry automatically; after max retries it moves to the DLQ.

**Attachments not found**
For `type: "s3"` attachments, the buffer is uploaded to S3 by the SDK at send time. The handler fetches it later. If the attachment S3 object has been deleted (past `attachmentsRetentionDays`), retried messages will fail.

**Template placeholders not replaced**
Ensure your `props` keys in `hydrateTemplate()` match the keys in `PreviewProps` exactly (case-sensitive). The token format is `$$$__KEY__$$$`.

## FAQ

**Can I send to multiple recipients?**
Yes. Pass an array to `recipients`. Each address is validated and normalised to lowercase.

**Are environment variables set automatically?**
Yes. `grantAccess(lambda)` grants IAM permissions and injects the required env vars.

**Why pre-build templates instead of rendering at runtime?**
Bundling React + react-dom + @react-email into a Lambda adds several MB and increases cold-start time. Pre-building produces static HTML/text JSON files; the Lambda only calls `hydrateTemplate()` to fill in runtime values.

**Can I use a custom SES configuration set?**
Yes. Pass `defaultConfigurationSet` to the construct for all sends, or `configurationSetName` per-send in `sendEmail()`.

**How do I handle bounces and complaints?**
Subscribe to `SES Bounce` and `SES Complaint` events via EventBridge and suppress those addresses. AWS requires bounce rate below 5% and complaint rate below 0.1%.

## Package Exports

| Entry point                          | Use in                 | Purpose                                                          |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------- |
| `@beesolve/email-service/cdk`        | CDK stack              | `Emails` construct — creates all AWS resources                   |
| `@beesolve/email-service/sdk`        | Lambda / server        | `Email` class — queues emails for sending                        |
| `@beesolve/email-service/templating` | Build scripts & Lambda | `renderEmail`, `hydrateTemplate`, `buildTemplates`, `BaseLayout` |
| `@beesolve/email-service/events`     | Lambda event handlers  | `parseEmailEvent` and typed event guards                         |

## Further Reading

- [EventBridge events](docs/eventbridge-events.md) — full CDK wiring, all event types, bounce/complaint handling, event correlation
- [React email templates](docs/react-email-templates.md) — writing templates, build script, multi-locale workflow, local preview
- [ADR-003: Pre-build templates](docs/adr-003-prebuild-templates.md) — why templates are compiled at build time instead of rendered in Lambda
