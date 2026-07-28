/**
 * Consumer-facing TypeScript types and helpers for @beesolve/email-service EventBridge events.
 *
 * Import from "@beesolve/email-service/events" in any Lambda that handles email events via SQS.
 *
 * Two event sources are covered:
 *  - "beesolve.email.api" — emitted by the email service (send success / failure)
 *  - "aws.ses" — emitted by SES (delivery, bounce, complaint, reject)
 */

import * as v from "valibot";

const emailSentSuccessSchema = v.object({
  source: v.literal("beesolve.email.api"),
  "detail-type": v.literal("EmailSentSuccess"),
  detail: v.object({
    requestId: v.string(),
    messageId: v.string(),
  }),
});

const emailSentFailureSchema = v.object({
  source: v.literal("beesolve.email.api"),
  "detail-type": v.literal("EmailSentFailure"),
  detail: v.object({
    requestId: v.string(),
  }),
});

export type EmailSentSuccessEvent = v.InferOutput<typeof emailSentSuccessSchema>;
export type EmailSentFailureEvent = v.InferOutput<typeof emailSentFailureSchema>;
export type EmailSentSuccessDetail = EmailSentSuccessEvent["detail"];
export type EmailSentFailureDetail = EmailSentFailureEvent["detail"];

export type BeeSolveEmailEvent = EmailSentSuccessEvent | EmailSentFailureEvent;

const sesMailSchema = v.object({
  timestamp: v.string(),
  messageId: v.string(),
  source: v.string(),
  sourceArn: v.optional(v.string()),
  sendingAccountId: v.string(),
  destination: v.array(v.string()),
  headersTruncated: v.boolean(),
  headers: v.array(v.object({ name: v.string(), value: v.string() })),
  commonHeaders: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
  tags: v.optional(v.record(v.string(), v.array(v.string()))),
});

const sesDeliverySchema = v.object({
  source: v.literal("aws.ses"),
  "detail-type": v.literal("SES Delivery"),
  detail: v.object({
    mail: sesMailSchema,
    delivery: v.object({
      timestamp: v.string(),
      processingTimeMillis: v.number(),
      recipients: v.array(v.string()),
      smtpResponse: v.string(),
      reportingMTA: v.string(),
    }),
  }),
});

const sesBounceSchema = v.object({
  source: v.literal("aws.ses"),
  "detail-type": v.literal("SES Bounce"),
  detail: v.object({
    mail: sesMailSchema,
    bounce: v.object({
      bounceType: v.union([
        v.literal("Permanent"),
        v.literal("Transient"),
        v.literal("Undetermined"),
      ]),
      bounceSubType: v.string(),
      bouncedRecipients: v.array(
        v.object({
          emailAddress: v.string(),
          action: v.optional(v.string()),
          status: v.optional(v.string()),
          diagnosticCode: v.optional(v.string()),
        }),
      ),
      timestamp: v.string(),
      feedbackId: v.string(),
      reportingMTA: v.optional(v.string()),
    }),
  }),
});

const sesComplaintSchema = v.object({
  source: v.literal("aws.ses"),
  "detail-type": v.literal("SES Complaint"),
  detail: v.object({
    mail: sesMailSchema,
    complaint: v.object({
      complainedRecipients: v.array(v.object({ emailAddress: v.string() })),
      timestamp: v.string(),
      feedbackId: v.string(),
      complaintFeedbackType: v.optional(v.string()),
      userAgent: v.optional(v.string()),
      arrivalDate: v.optional(v.string()),
    }),
  }),
});

const sesSendSchema = v.object({
  source: v.literal("aws.ses"),
  "detail-type": v.literal("SES Message Sent"),
  detail: v.object({
    mail: sesMailSchema,
    send: v.record(v.string(), v.never()),
  }),
});

const sesRejectSchema = v.object({
  source: v.literal("aws.ses"),
  "detail-type": v.literal("SES Reject"),
  detail: v.object({
    mail: sesMailSchema,
    reject: v.object({ reason: v.string() }),
  }),
});

export type SesDeliveryEvent = v.InferOutput<typeof sesDeliverySchema>;
export type SesBounceEvent = v.InferOutput<typeof sesBounceSchema>;
export type SesComplaintEvent = v.InferOutput<typeof sesComplaintSchema>;
export type SesSendEvent = v.InferOutput<typeof sesSendSchema>;
export type SesRejectEvent = v.InferOutput<typeof sesRejectSchema>;

export type SesDeliveryDetail = SesDeliveryEvent["detail"];
export type SesBounceDetail = SesBounceEvent["detail"];
export type SesComplaintDetail = SesComplaintEvent["detail"];
export type SesSendDetail = SesSendEvent["detail"];
export type SesRejectDetail = SesRejectEvent["detail"];

export type SesEvent =
  | SesDeliveryEvent
  | SesBounceEvent
  | SesComplaintEvent
  | SesSendEvent
  | SesRejectEvent;

export type EmailEvent = BeeSolveEmailEvent | SesEvent;

const emailEventSchema = v.variant("detail-type", [
  emailSentSuccessSchema,
  emailSentFailureSchema,
  sesDeliverySchema,
  sesBounceSchema,
  sesComplaintSchema,
  sesSendSchema,
  sesRejectSchema,
]);

/**
 * Parses a raw EventBridge event from an SQS record body string.
 * Returns `null` when the body is not a recognised email service event.
 */
export function parseEmailEvent(body: string): EmailEvent | null {
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), emailEventSchema), body);
  return result.success ? result.output : null;
}

export function isEmailSentSuccess(event: unknown): event is EmailSentSuccessEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "EmailSentSuccess";
}

export function isEmailSentFailure(event: unknown): event is EmailSentFailureEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "EmailSentFailure";
}

export function isSesDelivery(event: unknown): event is SesDeliveryEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SES Delivery";
}

export function isSesBounce(event: unknown): event is SesBounceEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SES Bounce";
}

export function isSesComplaint(event: unknown): event is SesComplaintEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SES Complaint";
}

export function isSesSend(event: unknown): event is SesSendEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SES Message Sent";
}

export function isSesReject(event: unknown): event is SesRejectEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (event as Record<string, unknown> | null)?.["detail-type"] === "SES Reject";
}
