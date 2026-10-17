import {
  ANALYTICS_REVERSE_INDEX,
  ANALYTICS_TABLE_NAME,
  ANALYTICS_USERS_REVERSE_INDEX,
  ANALYTICS_USERS_TABLE,
} from "$app/env/private";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  AppliedMarkers,
  Breakdowns,
  Config,
  SitemapUrlStats,
  Totals,
} from "@beesolve/analytics-processor";
import { AnalyticsClient } from "@beesolve/analytics-processor/sdk";
import { AuthClient } from "@beesolve/auth-service/sdk";
import { createSessionHandle, type SessionContext } from "@beesolve/auth-service/sveltekit";
import { Email } from "@beesolve/email-service/sdk";
import { redirect } from "@sveltejs/kit";
import { sequence, type Handle } from "@sveltejs/kit/hooks";

import { Setup } from "#lib/server/setup.js";
import { Users } from "#lib/server/users.js";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

const totals = new Totals({
  dynamo,
  tableName: ANALYTICS_TABLE_NAME,
  reverseIndexName: ANALYTICS_REVERSE_INDEX,
});
const breakdowns = new Breakdowns({
  dynamo,
  tableName: ANALYTICS_TABLE_NAME,
  reverseIndexName: ANALYTICS_REVERSE_INDEX,
});
const config = new Config({ dynamo, tableName: ANALYTICS_TABLE_NAME });
const sitemapUrlStats = new SitemapUrlStats({
  dynamo,
  tableName: ANALYTICS_TABLE_NAME,
  reverseIndexName: ANALYTICS_REVERSE_INDEX,
});
const markers = new AppliedMarkers({ dynamo, tableName: ANALYTICS_TABLE_NAME });
const users = new Users({
  dynamo,
  tableName: ANALYTICS_USERS_TABLE,
  reverseIndexName: ANALYTICS_USERS_REVERSE_INDEX,
});
const setup = new Setup({ dynamo, tableName: ANALYTICS_USERS_TABLE });
const authClient = new AuthClient();
const analyticsClient = new AnalyticsClient();
const email = new Email();

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/setup"]);

const authGuard: Handle = async ({ event, resolve }) => {
  event.locals.services = {
    totals,
    breakdowns,
    config,
    sitemapUrlStats,
    markers,
    users,
    setup,
    authClient,
    analyticsClient,
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
