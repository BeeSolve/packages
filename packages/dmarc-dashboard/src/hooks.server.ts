import { Setup } from "$lib/server/setup";
import { Users } from "$lib/server/users";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AuthClient } from "@beesolve/auth-service/sdk";
import { createSessionHandle, type SessionContext } from "@beesolve/auth-service/sveltekit";
import { Domains } from "@beesolve/dmarc-consumer/domain";
import { IpInfoCache } from "@beesolve/dmarc-consumer/ip-info";
import { ProcessingStats } from "@beesolve/dmarc-consumer/processing-stats";
import { Reports } from "@beesolve/dmarc-consumer/report";
import { AdminSdk } from "@beesolve/dmarc-consumer/sdk";
import { Email } from "@beesolve/email-service/sdk";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as v from "valibot";

const envSchema = v.object({
  DMARC_TABLE_NAME: v.string(),
  DMARC_REVERSE_INDEX: v.string(),
  IPINFO_API_KEY: v.optional(v.string()),
});
const env = v.parse(envSchema, process.env);

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

const users = new Users({
  dynamo,
  tableName: env.DMARC_TABLE_NAME,
  reverseIndexName: env.DMARC_REVERSE_INDEX,
});
const setup = new Setup({ dynamo, tableName: env.DMARC_TABLE_NAME });
const domains = new Domains({
  dynamo,
  tableName: env.DMARC_TABLE_NAME,
  reverseIndexName: env.DMARC_REVERSE_INDEX,
});
const reports = new Reports({ dynamo, tableName: env.DMARC_TABLE_NAME });
const stats = new ProcessingStats({ dynamo, tableName: env.DMARC_TABLE_NAME });
const ipInfoCache = new IpInfoCache({
  dynamo,
  tableName: env.DMARC_TABLE_NAME,
  apiKey: env.IPINFO_API_KEY,
});
const adminSdk = new AdminSdk();
const authClient = new AuthClient();
const email = new Email();

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/setup"]);

const authGuard: Handle = async ({ event, resolve }) => {
  event.locals.services = {
    users,
    setup,
    domains,
    reports,
    stats,
    ipInfoCache,
    adminSdk,
    authClient,
    email,
  };

  const isPublic = publicPaths.has(event.url.pathname);

  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  if (event.locals.session.type === "valid" && !isPublic) {
    try {
      const user = await users.getByEmail({ email: event.locals.session.validSession.userId });
      event.locals.user = { email: user.email, type: user.type, domains: user.domains };
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
// and you get that user's role/domains. Ignored entirely when running in Lambda.
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
