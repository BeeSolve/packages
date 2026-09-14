import * as v from "valibot";

export const validSessionSchema = v.variant("impersonating", [
  v.object({
    userId: v.string(),
    sessionId: v.string(),
    expiresAt: v.string(),
    impersonating: v.literal(false),
  }),
  v.object({
    userId: v.string(),
    sessionId: v.string(),
    expiresAt: v.string(),
    impersonating: v.literal(true),
    impersonatedBy: v.string(),
  }),
]);

export type ValidSession = v.InferOutput<typeof validSessionSchema>;
