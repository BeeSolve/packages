import { Messages } from "$lib/server/messages";
import { Recipients } from "$lib/server/recipients";
import { Requests } from "$lib/server/requests";
import { Setup } from "$lib/server/setup";
import { GlobalStats } from "$lib/server/stats";
import { Users } from "$lib/server/users";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AuthClient } from "@beesolve/auth-service/sdk";
import { createSessionHandle, type SessionContext } from "@beesolve/auth-service/sveltekit";
import { Email } from "@beesolve/email-service/sdk";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as v from "valibot";

const envSchema = v.object({
  DASHBOARD_TABLE_NAME: v.string(),
  DASHBOARD_REVERSE_INDEX: v.string(),
  DASHBOARD_REQUESTS_BUCKET: v.string(),
});
const env = v.parse(envSchema, process.env);

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

const messages = new Messages({
  dynamo,
  tableName: env.DASHBOARD_TABLE_NAME,
  reverseIndexName: env.DASHBOARD_REVERSE_INDEX,
});
const globalStats = new GlobalStats({ dynamo, tableName: env.DASHBOARD_TABLE_NAME });
const recipients = new Recipients({
  dynamo,
  tableName: env.DASHBOARD_TABLE_NAME,
  reverseIndexName: env.DASHBOARD_REVERSE_INDEX,
});
const users = new Users({
  dynamo,
  tableName: env.DASHBOARD_TABLE_NAME,
  reverseIndexName: env.DASHBOARD_REVERSE_INDEX,
});
const setup = new Setup({ dynamo, tableName: env.DASHBOARD_TABLE_NAME });
const authClient = new AuthClient();
const email = new Email();
const requests = new Requests({
  s3: new S3Client(),
  bucketName: env.DASHBOARD_REQUESTS_BUCKET,
});

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/setup"]);

const authGuard: Handle = async ({ event, resolve }) => {
  event.locals.services = {
    messages,
    globalStats,
    recipients,
    users,
    setup,
    authClient,
    email,
    requests,
  };

  const isPublic = publicPaths.has(event.url.pathname);

  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  if (event.locals.session.type === "valid" && !isPublic) {
    try {
      const user = await users.getByEmail({ email: event.locals.session.validSession.userId });
      event.locals.user = { email: user.email, type: user.type };
    } catch {
      event.locals.user = null;
    }
  } else {
    event.locals.user = null;
  }

  return resolve(event);
};

// In local dev the auth service applies `fallbackSession` automatically (there
// is no Lambda authorizer). Point it at a real user's email via DEV_USER_EMAIL
// so the downstream `users.getByEmail` lookup resolves against the real table
// and you get that user's role. Ignored entirely when running in Lambda.
const devUserEmail = process.env.DEV_USER_EMAIL;
const fallbackSession =
  import.meta.env.DEV && devUserEmail != null
    ? ({
        type: "valid" as const,
        validSession: {
          userId: devUserEmail,
          sessionId: "dev-session",
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        },
        setCookiesParams: [],
      } satisfies SessionContext)
    : undefined;

export const handle = sequence(createSessionHandle({ fallbackSession }), authGuard);
