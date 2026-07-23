# EventBridge events

The email service publishes events to EventBridge from two sources. This guide explains what events are emitted, how to subscribe to them, and how to handle them with full TypeScript types.

## Event sources

### `beesolve.email.api`

Published by the email service's queue handler Lambda after each send attempt.

| `detail-type`      | When                                          |
| ------------------ | --------------------------------------------- |
| `EmailSentSuccess` | SES accepted and sent the message             |
| `EmailSentFailure` | The Lambda failed to process the send request |

### `aws.ses`

Published directly by SES when delivery events occur. The `Emails` CDK construct tracks `SEND`, `BOUNCE`, `COMPLAINT`, `DELIVERY`, and `REJECT` by default. You can override this with `eventsToTrack`.

| `detail-type`      | When                                           |
| ------------------ | ---------------------------------------------- |
| `SES Message Sent` | SES accepted the message for sending           |
| `SES Delivery`     | Recipient's mail server confirmed delivery     |
| `SES Bounce`       | Hard or soft bounce from the recipient server  |
| `SES Complaint`    | Recipient marked the email as spam             |
| `SES Reject`       | SES rejected the message (e.g. detected virus) |

## Subscribing in CDK

Create an EventBridge rule that matches the relevant sources and routes events to your consumer.

```ts
import { Emails } from "@beesolve/email-service/cdk";
import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";

const emails = new Emails(this, "Emails", {
  defaultSender: { name: "My App", emailAddress: "no-reply@example.com" },
});

const consumer = new Nodejs24Function(this, "EmailEventProcessor", {
  entry: `${__dirname}/email-event-handler.ts`,
  handler: "email-event-handler.handler",
});

new Rule(this, "EmailEventsRule", {
  eventPattern: {
    source: ["beesolve.email.api", "aws.ses"],
  },
  targets: [new LambdaFunction(consumer)],
});
```

To narrow to specific event types:

```ts
new Rule(this, "BounceComplaintRule", {
  eventPattern: {
    source: ["aws.ses"],
    detailType: ["SES Bounce", "SES Complaint"],
  },
  targets: [new LambdaFunction(consumer)],
});
```

## Handling events in Lambda

Import `parseEmailEvent` and the type guard helpers from `@beesolve/email-service/events`:

```ts
import type { SQSEvent } from "aws-lambda";
import {
  isEmailSentFailure,
  isEmailSentSuccess,
  isSesBounce,
  isSesComplaint,
  isSesDelivery,
  isSesReject,
  isSesSend,
  parseEmailEvent,
} from "@beesolve/email-service/events";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const emailEvent = parseEmailEvent(record.body);
    if (emailEvent == null) continue;

    // beesolve.email.api events
    if (isEmailSentSuccess(emailEvent)) {
      const { requestId, messageId } = emailEvent.detail;
      console.log("Sent", { requestId, messageId });
    }

    if (isEmailSentFailure(emailEvent)) {
      const { requestId } = emailEvent.detail;
      console.error("Send failed for request", requestId);
    }

    // aws.ses events
    if (isSesDelivery(emailEvent)) {
      const { recipients, smtpResponse } = emailEvent.detail.delivery;
      console.log("Delivered to", recipients, smtpResponse);
    }

    if (isSesBounce(emailEvent)) {
      const { bounceType, bouncedRecipients } = emailEvent.detail.bounce;
      const emails = bouncedRecipients.map((r) => r.emailAddress);
      console.warn("Bounce", bounceType, emails);
      await suppressEmailAddresses(emails);
    }

    if (isSesComplaint(emailEvent)) {
      const addresses = emailEvent.detail.complaint.complainedRecipients.map((r) => r.emailAddress);
      console.warn("Complaint from", addresses);
      await suppressEmailAddresses(addresses);
    }

    if (isSesReject(emailEvent)) {
      console.error("SES rejected:", emailEvent.detail.reject.reason);
    }

    if (isSesSend(emailEvent)) {
      console.log("SES accepted message", emailEvent.detail.mail.messageId);
    }
  }
};
```

`parseEmailEvent` returns `null` for unknown or malformed records, so the loop safely skips events from other sources.

## Bounce and complaint handling

**Bounces and complaints affect your SES sender reputation.** When you receive a `SES Bounce` (especially `Permanent`) or a `SES Complaint`, you should stop sending to those addresses.

AWS requires maintaining your bounce rate below 5% and complaint rate below 0.1% to avoid SES suspension. Implement suppression as soon as you start sending at volume.

A minimal suppression pattern using the SES account-level suppression list:

```ts
import { PutSuppressedDestinationCommand, SESv2Client } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({});

async function suppressEmailAddresses(addresses: string[]): Promise<void> {
  await Promise.all(
    addresses.map((email) =>
      ses.send(
        new PutSuppressedDestinationCommand({
          EmailAddress: email,
          Reason: "BOUNCE", // or "COMPLAINT"
        }),
      ),
    ),
  );
}
```

## Correlating events

The `EmailSentSuccess` event includes both a `requestId` (generated by the SDK when you call `sendEmail`) and a `messageId` (assigned by SES). The `aws.ses` events carry the SES `messageId` in `detail.mail.messageId`.

Join on `messageId` to correlate your application's send request with downstream delivery/bounce events:

```
sendEmail(requestId: "abc") → EmailSentSuccess { requestId: "abc", messageId: "ses-xyz" }
                             → SES Delivery { mail.messageId: "ses-xyz" }
```

## Available types

```ts
import type {
  EmailEvent, // BeeSolveEmailEvent | SesEvent
  BeeSolveEmailEvent,
  SesEvent,
  EmailSentSuccessEvent,
  EmailSentFailureEvent,
  EmailSentSuccessDetail,
  EmailSentFailureDetail,
  SesDeliveryEvent,
  SesBounceEvent,
  SesComplaintEvent,
  SesSendEvent,
  SesRejectEvent,
  SesDeliveryDetail,
  SesBounceDetail,
  SesComplaintDetail,
  SesSendDetail,
  SesRejectDetail,
} from "@beesolve/email-service/events";
```
