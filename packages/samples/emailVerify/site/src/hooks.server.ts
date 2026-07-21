import { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import { Email } from "@beesolve/email-service/sdk";
import type { Handle, ServerInit } from "@sveltejs/kit";
import * as v from "valibot";

export const env = v.parse(
  v.object({
    RECIPIENT_EMAIL: v.pipe(v.string(), v.email()),
    OTP_EXPIRY_SECONDS: v.optional(v.pipe(v.string(), v.transform(Number)), "600"),
    THROTTLE_WINDOW_SECONDS: v.optional(v.pipe(v.string(), v.transform(Number)), "60"),
  }),
  process.env,
);

export type Environment = typeof env;

const actionTokens = new ActionTokensClient();
const emailService = new Email();

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.env = env;
  event.locals.actionTokens = actionTokens;
  event.locals.emailService = emailService;

  return await resolve(event);
};

export const init: ServerInit = async () => {};
