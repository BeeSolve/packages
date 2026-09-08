import * as v from "valibot";

export const defaultLimit = 100;

export const emailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email());

export const countersSchema = v.object({
  received: v.optional(v.number(), 0),
  sent: v.optional(v.number(), 0),
  delivered: v.optional(v.number(), 0),
  bounced: v.optional(v.number(), 0),
  complained: v.optional(v.number(), 0),
  rejected: v.optional(v.number(), 0),
  failed: v.optional(v.number(), 0),
});

export const recipientSchema = v.object({
  pk: emailSchema,
  sk: v.literal("recipient"),
  ...countersSchema.entries,
});
export type Recipient = v.InferOutput<typeof recipientSchema>;

export const statsSchema = v.object({
  pk: v.literal("stats"),
  sk: v.literal("global"),
  ...countersSchema.entries,
});
export type Stats = v.InferOutput<typeof statsSchema>;

export const setupSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.literal("setup"),
  completedAt: v.string(),
  adminEmail: emailSchema,
});
export type SetupConfig = v.InferOutput<typeof setupSchema>;

export function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  if (key == null) return undefined;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (cursor == null) return undefined;
  const decoded = Buffer.from(cursor, "base64").toString("utf8");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(decoded) as Record<string, unknown>;
}
