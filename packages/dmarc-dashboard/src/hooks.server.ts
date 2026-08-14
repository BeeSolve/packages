import { Setup } from "$lib/server/setup";
import { Users } from "$lib/server/users";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AuthClient } from "@beesolve/auth-service/sdk";
import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
import { Domains } from "@beesolve/dmarc-consumer/domain";
import { Reports } from "@beesolve/dmarc-consumer/report";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as v from "valibot";

const envSchema = v.object({
  DMARC_TABLE_NAME: v.string(),
  DMARC_REVERSE_INDEX: v.string(),
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
const authClient = new AuthClient();

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/setup"]);

const authGuard: Handle = async ({ event, resolve }) => {
  event.locals.services = { users, setup, domains, reports, authClient };

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

export const handle = sequence(createSessionHandle(), authGuard);
