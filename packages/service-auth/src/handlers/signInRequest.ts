import { randomBytes } from "node:crypto";
import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import { asNull } from "@beesolve/helpers";
import * as v from "valibot";
import type { Accounts } from "../account.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import { generateOTP } from "../util.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "createNew">;
  readonly accounts: Pick<Accounts, "getOne">;
  readonly events: Pick<Events, "putEvents">;
  readonly baseUri: string;
  readonly requestBody: () => Promise<any>;
  readonly cookies: Record<string, string>;
  readonly acceptLanguage: string | null;
  readonly requestOrigin: string | null;
  /** OTP validity period in seconds. */
  readonly otpExpirySeconds: number;
}

const schema = v.object({
  emailAddress: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
});

export async function signInRequest({
  actionTokens,
  events,
  accounts,
  baseUri,
  requestBody,
  cookies,
  acceptLanguage,
  requestOrigin,
  otpExpirySeconds,
}: Dependencies): Promise<Response> {
  const { emailAddress } = parseBody({
    body: await requestBody(),
    schema,
  });

  const account = await accounts.getOne(emailAddress).catch(asNull);

  const token = randomBytes(32).toString("base64url");
  const code = generateOTP();

  const expiresAt = new Date();
  expiresAt.setUTCSeconds(expiresAt.getUTCSeconds() + otpExpirySeconds);

  await actionTokens.createNew({
    action: "signInRequest",
    data: { emailAddress },
    expiresAt,
    overwrite: true,
    owner: token,
    remainingUses: 10,
    value: code,
  });

  await events.putEvents({
    type: "EmailCodeAuth",
    detail: {
      code,
      emailAddress,
      expiresAt: expiresAt.toISOString(),
      accountId: account?.id ?? null,
      baseUri,
      cookies,
      acceptLanguage,
      requestOrigin,
    },
  });

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: new Headers({
      "content-type": "application/json",
    }),
  });
}
