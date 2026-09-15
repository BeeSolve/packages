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

interface SessionIdentity {
  readonly userId: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly impersonatedId?: string;
}

export function toValidSession(session: SessionIdentity): ValidSession {
  if (session.impersonatedId != null) {
    return {
      userId: session.impersonatedId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      impersonating: true,
      impersonatedBy: session.userId,
    };
  }

  return {
    userId: session.userId,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    impersonating: false,
  };
}
