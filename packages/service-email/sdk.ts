import { randomBytes } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { assertUnreachable, call } from "@beesolve/helpers";
import * as v from "valibot";

const message = `It seems that Emails service has not been set up correctly. Please make sure you've used official CDK construct and that you've granted access to your labmda function.`;
const envSchema = v.object({
  BEESOLVE_EMAILS_QUEUE_URL: v.config(v.string(), { message }),
  BEESOLVE_EMAILS_ATTACHMENTS_BUCKET: v.config(v.string(), { message }),
});
const env = v.parse(envSchema, process.env);

const s3Client = new S3Client();
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
}
