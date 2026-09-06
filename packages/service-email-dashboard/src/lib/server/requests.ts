import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import * as v from "valibot";

export const emailRequestSchema = v.object({
  id: v.string(),
  recipients: v.array(v.pipe(v.string(), v.email(), v.toLowerCase())),
  replyToAddresses: v.optional(v.array(v.pipe(v.string(), v.email(), v.toLowerCase()))),
  subject: v.string(),
  html: v.string(),
  text: v.optional(v.string()),
  sender: v.optional(
    v.object({
      name: v.string(),
      emailAddress: v.pipe(v.string(), v.email()),
    }),
  ),
  attachments: v.optional(
    v.array(
      v.variant("type", [
        v.object({
          type: v.literal("public"),
          mimeType: v.string(),
          publicUrl: v.string(),
          customName: v.string(),
        }),
        v.object({
          type: v.literal("s3"),
          mimeType: v.string(),
          fileId: v.string(),
          customName: v.string(),
        }),
      ]),
    ),
  ),
  configurationSetName: v.optional(v.string()),
});

export type EmailRequest = v.InferOutput<typeof emailRequestSchema>;

export class Requests {
  constructor(
    private readonly props: {
      readonly s3: Pick<S3Client, "send">;
      readonly bucketName: string;
    },
  ) {}

  readonly put = async ({
    messageId,
    request,
  }: {
    readonly messageId: string;
    readonly request: EmailRequest;
  }): Promise<void> => {
    await this.props.s3.send(
      new PutObjectCommand({
        Bucket: this.props.bucketName,
        Key: objectKey(messageId),
        Body: JSON.stringify(request),
        ContentType: "application/json",
      }),
    );
  };

  readonly get = async ({
    messageId,
  }: {
    readonly messageId: string;
  }): Promise<EmailRequest | null> => {
    try {
      const { Body } = await this.props.s3.send(
        new GetObjectCommand({
          Bucket: this.props.bucketName,
          Key: objectKey(messageId),
        }),
      );

      if (Body == null) return null;

      const raw = await Body.transformToString();
      return v.parse(v.pipe(v.string(), v.parseJson(), emailRequestSchema), raw);
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  };
}

function objectKey(messageId: string): string {
  return `messages/${messageId}.json`;
}
