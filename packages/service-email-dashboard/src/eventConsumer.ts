import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
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
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import * as v from "valibot";

import { Messages } from "./lib/server/messages";
import { Requests } from "./lib/server/requests";
import { GlobalStats } from "./lib/server/stats";

const env = v.parse(
  v.object({
    DASHBOARD_TABLE_NAME: v.string(),
    DASHBOARD_REVERSE_INDEX: v.string(),
    DASHBOARD_REQUESTS_BUCKET: v.string(),
  }),
  process.env,
);

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

const messages = new Messages({
  dynamo,
  tableName: env.DASHBOARD_TABLE_NAME,
  reverseIndexName: env.DASHBOARD_REVERSE_INDEX,
});
const stats = new GlobalStats({
  dynamo,
  tableName: env.DASHBOARD_TABLE_NAME,
});
const requests = new Requests({
  s3: new S3Client(),
  bucketName: env.DASHBOARD_REQUESTS_BUCKET,
});

export const createHandler = ({
  messages,
  stats,
  requests,
}: {
  readonly messages: Pick<Messages, "upsert">;
  readonly stats: Pick<GlobalStats, "addFailure">;
  readonly requests: Pick<Requests, "put">;
}): ((event: SQSEvent) => Promise<SQSBatchResponse>) => {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: Array<{ itemIdentifier: string }> = [];

    for (const record of event.Records) {
      try {
        const parsed = parseEmailEvent(record.body);
        if (parsed == null) continue;

        if (isEmailSentFailure(parsed)) {
          await stats.addFailure();
          continue;
        }

        if (isEmailSentSuccess(parsed)) {
          const now = new Date().toISOString();
          await messages.upsert({
            eventId: parsed.id,
            messageId: parsed.detail.messageId,
            recipients: parsed.detail.request.recipients,
            subject: parsed.detail.request.subject,
            // EmailSentSuccess may omit `sender` (the service applies its
            // configured default sender at send time). The subsequent SES
            // "Message Sent" event carries the real `mail.source` and overwrites
            // this via the same upsert, so an empty placeholder is fine here.
            sender: parsed.detail.request.sender?.emailAddress ?? "",
            createdAt: now,
            data: {
              status: "requested",
              requestId: parsed.detail.requestId,
              timestamp: now,
            },
          });
          await requests.put({
            messageId: parsed.detail.messageId,
            request: parsed.detail.request,
          });
          continue;
        }

        if (isSesSend(parsed)) {
          await messages.upsert({
            eventId: parsed.id,
            messageId: parsed.detail.mail.messageId,
            recipients: parsed.detail.mail.destination,
            subject: commonHeaderString(parsed.detail.mail.commonHeaders, "subject"),
            sender: parsed.detail.mail.source,
            createdAt: parsed.detail.mail.timestamp,
            data: { status: "sent", timestamp: parsed.detail.mail.timestamp },
          });
          continue;
        }

        if (isSesDelivery(parsed)) {
          await messages.upsert({
            eventId: parsed.id,
            messageId: parsed.detail.mail.messageId,
            recipients: parsed.detail.mail.destination,
            subject: commonHeaderString(parsed.detail.mail.commonHeaders, "subject"),
            sender: parsed.detail.mail.source,
            createdAt: parsed.detail.mail.timestamp,
            data: {
              status: "delivered",
              deliveredAt: parsed.detail.delivery.timestamp,
              deliveryMs: parsed.detail.delivery.processingTimeMillis,
              timestamp: parsed.detail.delivery.timestamp,
              recipients: parsed.detail.mail.destination,
            },
          });
          continue;
        }

        if (isSesBounce(parsed)) {
          const diagnosticCode = parsed.detail.bounce.bouncedRecipients.find(
            (bouncedRecipient) => bouncedRecipient.diagnosticCode != null,
          )?.diagnosticCode;
          await messages.upsert({
            eventId: parsed.id,
            messageId: parsed.detail.mail.messageId,
            recipients: parsed.detail.mail.destination,
            subject: commonHeaderString(parsed.detail.mail.commonHeaders, "subject"),
            sender: parsed.detail.mail.source,
            createdAt: parsed.detail.mail.timestamp,
            data: {
              status: "bounced",
              bounceType: parsed.detail.bounce.bounceType,
              bounceSubType: parsed.detail.bounce.bounceSubType,
              recipients: parsed.detail.bounce.bouncedRecipients.map(
                (bouncedRecipient) => bouncedRecipient.emailAddress,
              ),
              ...(diagnosticCode != null ? { diagnosticCode } : {}),
              at: parsed.detail.bounce.timestamp,
              timestamp: parsed.detail.bounce.timestamp,
            },
          });
          continue;
        }

        if (isSesComplaint(parsed)) {
          await messages.upsert({
            eventId: parsed.id,
            messageId: parsed.detail.mail.messageId,
            recipients: parsed.detail.mail.destination,
            subject: commonHeaderString(parsed.detail.mail.commonHeaders, "subject"),
            sender: parsed.detail.mail.source,
            createdAt: parsed.detail.mail.timestamp,
            data: {
              status: "complained",
              recipients: parsed.detail.complaint.complainedRecipients.map(
                (complainedRecipient) => complainedRecipient.emailAddress,
              ),
              ...(parsed.detail.complaint.complaintFeedbackType != null
                ? { feedbackType: parsed.detail.complaint.complaintFeedbackType }
                : {}),
              at: parsed.detail.complaint.timestamp,
              timestamp: parsed.detail.complaint.timestamp,
            },
          });
          continue;
        }

        if (isSesReject(parsed)) {
          await messages.upsert({
            eventId: parsed.id,
            messageId: parsed.detail.mail.messageId,
            recipients: parsed.detail.mail.destination,
            subject: commonHeaderString(parsed.detail.mail.commonHeaders, "subject"),
            sender: parsed.detail.mail.source,
            createdAt: parsed.detail.mail.timestamp,
            data: {
              status: "rejected",
              reason: parsed.detail.reject.reason,
              at: parsed.detail.mail.timestamp,
              timestamp: parsed.detail.mail.timestamp,
              recipients: parsed.detail.mail.destination,
            },
          });
          continue;
        }
      } catch (error) {
        console.error(error);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
};

export const handler = createHandler({ messages, stats, requests });

function commonHeaderString(
  headers: Record<string, string | Array<string>> | undefined,
  key: string,
): string {
  if (headers == null) return "";
  const value = headers[key];
  if (value == null) return "";
  if (Array.isArray(value)) return value[0] ?? "";
  return value;
}
