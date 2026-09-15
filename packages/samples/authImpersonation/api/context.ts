import { getAwsLambdaAuthorizerContext } from "@beesolve/lambda-fetch-api";
import * as v from "valibot";

const sessionSchema = v.variant("type", [
  v.object({
    type: v.literal("valid"),
    validSession: v.variant("impersonating", [
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
    ]),
    setCookiesParams: v.array(v.object({ sid: v.string(), maxAge: v.number() })),
  }),
  v.object({
    type: v.literal("invalid"),
    error: v.string(),
    setCookiesParams: v.array(v.object({ sid: v.string(), maxAge: v.number() })),
  }),
  v.object({
    type: v.literal("expired"),
    expiredSession: v.object({
      userId: v.string(),
      sessionId: v.string(),
      expiredAt: v.string(),
    }),
    setCookiesParams: v.array(v.object({ sid: v.string(), maxAge: v.number() })),
  }),
]);

const authorizerContextSchema = v.object({
  session: v.pipe(
    v.string(),
    v.transform((value) => JSON.parse(value) as unknown),
    sessionSchema,
  ),
});

export interface Session {
  userId: string;
  impersonating: boolean;
  impersonatedBy?: string;
}

export async function createContext(): Promise<{ session: Session | undefined }> {
  const ctx = await getAwsLambdaAuthorizerContext(authorizerContextSchema);

  if (ctx.session.type !== "valid") return { session: undefined };

  const { validSession } = ctx.session;
  if (validSession.impersonating) {
    return {
      session: {
        userId: validSession.userId,
        impersonating: true,
        impersonatedBy: validSession.impersonatedBy,
      },
    };
  }

  return { session: { userId: validSession.userId, impersonating: false } };
}
