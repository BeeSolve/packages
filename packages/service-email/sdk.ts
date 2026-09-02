import { randomBytes } from "node:crypto";

import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { assertUnreachable, call } from "@beesolve/helpers";
import * as v from "valibot";

import { dynamoClient, s3Client } from "./src/aws";
import { requestSchema } from "./src/validation";

const message = `It seems that Emails service has not been set up correctly. Please make sure you've used official CDK construct and that you've granted access to your labmda function.`;
const envSchema = v.object({
  BEESOLVE_EMAILS_QUEUE_URL: v.config(v.string(), { message }),
  BEESOLVE_EMAILS_TABLE_NAME: v.config(v.string(), { message }),
  BEESOLVE_EMAILS_ATTACHMENTS_BUCKET: v.config(v.string(), { message }),
});
const env = v.parse(envSchema, process.env);

const sqsClient = new SQSClient({});

type Attachment =
  | {
      readonly type: "public";
      readonly mimeType: string;
      readonly publicUrl: string;
      readonly customName: string;
    }
  | {
      readonly type: "s3";
      readonly mimeType: string;
      readonly body: Buffer;
      readonly customName: string;
    };

interface Sender {
  readonly name: string;
  readonly emailAddress: string;
}

export class Email {
  private readonly s3Client: S3Client;
  private readonly sqsClient: SQSClient;

  constructor(
    private readonly props: {
      readonly s3Client?: S3Client;
      readonly sqsClient?: SQSClient;
    } = {},
  ) {
    this.s3Client = props.s3Client ?? s3Client;
    this.sqsClient = props.sqsClient ?? sqsClient;
  }

  readonly sendEmail = async (request: {
    readonly recipients: Array<string>;
    readonly subject: string;
    readonly html: string;
    readonly text?: string;
    /**
     * This address needs to be verified through SES
     * Overrides locally the default sender
     */
    readonly sender?: Sender;
    /**
     * This address does not need to be verified through SES
     * The address is used when you hit "reply" in your email client
     */
    readonly replyToAddresses?: Array<string>;
    readonly attachments?: Array<Attachment>;
    readonly configurationSetName?: string;
  }): Promise<{ requestId: string }> => {
    const id = randomBytes(32).toString("base64url");

    const { attachments, ...rest } = request;

    const resolvedAttachments = attachments
      ? await call(async () => {
          return Promise.all(
            attachments.map(async (item) => {
              if (item.type === "public") return item;
              if (item.type === "s3") {
                const fileId = randomBytes(32).toString("base64url");

                const { body, ...rest } = item;

                await this.s3Client.send(
                  new PutObjectCommand({
                    Bucket: env.BEESOLVE_EMAILS_ATTACHMENTS_BUCKET,
                    Key: fileId,
                    Body: body,
                  }),
                );

                return {
                  ...rest,
                  fileId,
                };
              }
              assertUnreachable(item);
            }),
          );
        })
      : undefined;

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.BEESOLVE_EMAILS_QUEUE_URL,
        MessageBody: JSON.stringify({
          id,
          ...rest,
          attachments: resolvedAttachments,
        }),
      }),
    );

    return { requestId: id };
  };

  readonly getMessage = async (
    requestId: string,
  ): Promise<{
    readonly requestId: string;
    readonly messageId: string;
    readonly request: v.InferOutput<typeof requestSchema>;
    readonly expiresAt: Date;
  }> => {
    const { Items = [] } = await dynamoClient.send(
      new QueryCommand({
        TableName: env.BEESOLVE_EMAILS_TABLE_NAME,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: {
          "#pk": "pk",
        },
        ExpressionAttributeValues: {
          ":pk": requestId,
        },
      }),
    );

    if (Items.length === 0) {
      throw new EmailServiceError(
        "message_not_found",
        `Message for ${requestId} has not been found. Make sure you have set up messagesRetentionDays properly.`,
      );
    }
    if (Items.length !== 1) {
      throw new EmailServiceError(
        "unexpected",
        `There are multiple records for ${requestId} which should not happen.`,
      );
    }

    const result = v.safeParse(
      v.object({
        request: requestSchema,
        pk: v.string(),
        sk: v.string(),
        ttl: v.number(),
      }),
      Items[0],
    );
    if (!result.success) {
      throw new EmailServiceError("malformed_request", `Persisted request is malformed.`);
    }

    return {
      requestId: result.output.pk,
      messageId: result.output.sk,
      request: result.output.request,
      expiresAt: new Date(result.output.ttl * 1000),
    };
  };
}

export class EmailServiceError extends Error {
  constructor(
    public readonly code: "message_not_found" | "malformed_request" | "unexpected",
    message: string,
  ) {
    super(message);
    this.name = "EmailServiceError";
  }
}
