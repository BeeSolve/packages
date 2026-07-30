import { getAwsLambdaAuthorizerContext } from "@beesolve/lambda-fetch-api";
import * as v from "valibot";

const authorizerContextSchema = v.object({
  userId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
});

export interface Context {
  userId: string | undefined;
}

export async function createContext(): Promise<Context> {
  const ctx = await getAwsLambdaAuthorizerContext(authorizerContextSchema);
  return { userId: ctx.userId };
}
