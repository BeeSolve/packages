import { SampleUsers } from "$lib/server/sampleUsers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AuthClient } from "@beesolve/auth-service/sdk";
import { createSessionHandle, type SessionContext } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as v from "valibot";

const envSchema = v.object({
  SAMPLE_USERS_TABLE_NAME: v.string(),
  SAMPLE_USERS_REVERSE_INDEX: v.string(),
});
const env = v.parse(envSchema, process.env);

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

const sampleUsers = new SampleUsers({
  dynamo,
  tableName: env.SAMPLE_USERS_TABLE_NAME,
  reverseIndexName: env.SAMPLE_USERS_REVERSE_INDEX,
});
const authClient = new AuthClient();

const publicPaths = new Set(["/sign-in", "/sign-in/verify"]);

const authGuard: Handle = async ({ event, resolve }) => {
  event.locals.services = { sampleUsers, authClient };

  const isPublic = publicPaths.has(event.url.pathname);

  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  if (event.locals.session.type === "valid" && !isPublic) {
    const { userId } = event.locals.session.validSession;
    await sampleUsers.upsert({ email: userId, userId });
    event.locals.user = { email: userId };
  } else {
    event.locals.user = null;
  }

  return resolve(event);
};

const devUserEmail = process.env.DEV_USER_EMAIL;
const fallbackSession =
  import.meta.env.DEV && devUserEmail != null
    ? ({
        type: "valid" as const,
        validSession: {
          userId: devUserEmail,
          sessionId: "dev-session",
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          impersonating: false,
        },
        setCookiesParams: [],
      } satisfies SessionContext)
    : undefined;

export const handle = sequence(createSessionHandle({ fallbackSession }), authGuard);
