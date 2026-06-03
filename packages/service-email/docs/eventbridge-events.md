# EventBridge events

The email service publishes events to EventBridge from two sources. This guide explains what events are emitted, how to subscribe to them, and how to handle them with full TypeScript types.

---

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

---

## Subscribing in CDK

Create an EventBridge rule that matches the relevant sources and routes events to your Lambda via SQS.

```ts
import { Emails } from "@beesolve/email-service/cdk";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

// Create the email service
const emails = new Emails(this, "Emails", {
  defaultSender: { name: "My App", emailAddress: "no-reply@example.com" },
});

// Your event processor
const processorQueue = new Queue(this, "EmailEventQueue");
const processorLambda = new NodejsFunction(this, "EmailEventProcessor", { ... });
processorQueue.grantConsumeMessages(processorLambda);
processorLambda.addEventSource(new SqsEventSource(processorQueue));

// EventBridge rule — matches both beesolve.email.api and aws.ses events
const eventBus = EventBus.fromEventBusName(this, "DefaultBus", "default");

new Rule(this, "EmailEventsRule", {
  eventBus,
  eventPattern: {
    source: ["beesolve.email.api", "aws.ses"],
  },
  targets: [new SqsQueue(processorQueue)],
});
```

To narrow to specific event types:

```ts
eventPattern: {
  source: ["aws.ses"],
  detailType: ["SES Bounce", "SES Complaint"],
},
```

---

## Handling events in Lambda

Import `parseEmailEvent` and the type guard helpers from `@beesolve/email-service/events`.

```ts
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
import type { SQSEvent } from "aws-lambda";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const emailEvent = parseEmailEvent(record.body);
    if (!emailEvent) continue;

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
      // Suppress bounced addresses to protect sender reputation
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

---

## Available types

```ts
import type {
  // Union types
  EmailEvent, // BeeSolveEmailEvent | SesEvent
  BeeSolveEmailEvent,
  SesEvent,

  // beesolve.email.api
  EmailSentSuccessEvent,
  EmailSentFailureEvent,
  EmailSentSuccessDetail,
  EmailSentFailureDetail,

  // aws.ses
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

---

## Bounce and complaint handling

**Bounces and complaints affect your SES sender reputation.** When you receive a `SES Bounce` (especially `Permanent`) or a `SES Complaint`, you should stop sending to those addresses.

AWS requires maintaining your bounce rate below 5% and complaint rate below 0.1% to avoid SES suspension. Implement suppression as soon as you start sending at volume.

A minimal suppression pattern:

```ts
import { SESv2Client, PutSuppressedDestinationCommand } from "@aws-sdk/client-sesv2";

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

---

## Correlating beesolve.email.api and aws.ses events

The `EmailSentSuccess` event includes both a `requestId` (generated by the SDK) and a `messageId` (assigned by SES). The `aws.ses` events carry the SES `messageId` in `detail.mail.messageId`. You can join on `messageId` to correlate your application's send request with the downstream delivery or bounce event.
