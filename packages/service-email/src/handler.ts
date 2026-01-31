import { EventBridge } from "@aws-sdk/client-eventbridge";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { SendRawEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { asNull, assertUnreachable, call } from "@beesolve/helpers";
import type { SQSEvent } from "aws-lambda";
import { createMimeMessage } from "mimetext";
import * as v from "valibot";
import { dynamoClient, s3Client } from "./aws";
import { Events } from "./events";
import { requestSchema } from "./validation";

const message = `It seems that Emails service has not been set up correctly. Please make sure you've used official CDK construct and that you've granted access to your labmda function.`;
const envSchema = v.object({
  BUCKET_NAME: v.config(v.string(), { message }),
  TABLE_NAME: v.config(v.string(), { message }),
  DEFAULT_SENDER_NAME: v.config(v.string(), { message }),
  DEFAULT_SENDER_EMAIL_ADDRESS: v.config(v.string(), { message }),
  FROM_ARN: v.optional(v.string()),
  DEFAULT_CONFIGURATION_SET_NAME: v.optional(v.string()),
  MESSAGES_RETENTION_DAYS: v.pipe(
    v.string(),
    v.transform((value) => Number(value)),
    v.number(),
  ),
  EVENT_BUS_ARN: v.string(),
});
const env = v.parse(envSchema, process.env);

const schema = v.pipe(v.string(), v.parseJson(), requestSchema);

const sesClient = new SESClient();

const events = new Events({
  client: new EventBridge(),
  eventBusArn: env.EVENT_BUS_ARN,
});

export const handler = async (event: SQSEvent) => {
  const batchItemFailures = new Array<{ itemIdentifier: string }>();

  for (const record of event.Records) {
    try {
      const result = v.safeParse(schema, record.body);

      if (!result.success) {
        console.error(v.flatten(result.issues));
        throw new Error(`Cannot parse record body.`);
      }

      const request = result.output;

      const email = createMimeMessage();

      email.setRecipient(request.recipients.map((addr) => ({ addr })));
      email.setSubject(request.subject);
      email.addMessage({ contentType: "text/html", data: request.html });
      if (request.text != null) {
        email.addMessage({ contentType: "text/plain", data: request.text });
      }
      email.setSender(
        request.sender
          ? {
              name: request.sender.name,
              addr: request.sender.emailAddress,
              type: "From",
            }
          : {
              name: env.DEFAULT_SENDER_NAME,
              addr: env.DEFAULT_SENDER_EMAIL_ADDRESS,
              type: "From",
            },
      );

      if (request.attachments != null) {
        await Promise.all(
          request.attachments.map(async (item) => {
            const attachment = await call(async () => {
              if (item.type === "public") {
                return fetch(item.publicUrl).then((response) =>
                  response.arrayBuffer(),
                );
              }
              if (item.type === "s3") {
                const object = await s3Client
                  .send(
                    new GetObjectCommand({
                      Bucket: env.BUCKET_NAME,
                      Key: item.fileId,
                    }),
                  )
                  .catch(asNull);

                if (object == null) throw Error(`Attachment not found.`);
                if (object.Body == null) throw Error("Attachment is empty.");

                const byteArray = await object.Body.transformToByteArray();

                // todo: test this properly
                const arrayBuffer = byteArray.buffer.slice(
                  byteArray.byteOffset,
                  byteArray.byteOffset + byteArray.byteLength,
                );

                return arrayBuffer;
              }
              assertUnreachable(item);
            });

            email.addAttachment({
              filename: item.customName,
              contentType: item.mimeType,
              data: Buffer.from(attachment).toString("base64"),
            });
          }),
        );
      }

      const { MessageId } = await sesClient.send(
        new SendRawEmailCommand({
          RawMessage: {
            Data: Buffer.from(email.asRaw(), "utf-8"),
          },
          FromArn: env.FROM_ARN,
          Destinations: request.recipients,
          ConfigurationSetName:
            request.configurationSetName ?? env.DEFAULT_CONFIGURATION_SET_NAME,
        }),
      );

      if (MessageId == null) {
        await events.putEvents({
          type: "EmailSentFailure",
          detail: {
            requestId: request.id,
          },
        });
        throw Error(`SES didn't returned MessageId.`);
      }

      await events.putEvents({
        type: "EmailSentSuccess",
        detail: {
          requestId: request.id,
          messageId: MessageId,
        },
      });

      if (env.MESSAGES_RETENTION_DAYS != 0) {
        const ttl = new Date();
        ttl.setUTCDate(ttl.getUTCDate() + env.MESSAGES_RETENTION_DAYS);

        await dynamoClient.send(
          new PutCommand({
            TableName: env.TABLE_NAME,
            Item: {
              pk: request.id,
              messageId: MessageId,
              request,
              ttl: Math.floor(ttl.getTime() / 1000),
            },
          }),
        );
      }
    } catch (error) {
      console.error(error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
