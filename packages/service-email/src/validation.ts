import * as v from "valibot";

export const requestSchema = v.object({
  id: v.string(),
  recipients: v.array(v.pipe(v.string(), v.email(), v.toLowerCase())),
  subject: v.string(),
  html: v.string(),
  text: v.optional(v.string()),
  sender: v.optional(
    v.object({
      name: v.string(),
      emailAddress: v.string(),
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
