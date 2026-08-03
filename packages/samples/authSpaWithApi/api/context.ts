import { getAwsLambdaAuthorizerContext } from "@beesolve/lambda-fetch-api";
import * as v from "valibot";

const sessionSchema = v.variant("type", [
  v.object({
    type: v.literal("valid"),
    validSession: v.object({
      userId: v.string(),
      sessionId: v.string(),
      expiresAt: v.string(),
    }),
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

export interface Context {
  userId: string | undefined;
}

export async function createContext(): Promise<Context> {
  const ctx = await getAwsLambdaAuthorizerContext(authorizerContextSchema);
  const userId = ctx.session.type === "valid" ? ctx.session.validSession.userId : undefined;
  return { userId };
}
