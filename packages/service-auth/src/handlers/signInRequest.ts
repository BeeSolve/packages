import { randomBytes } from "node:crypto";

import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import { asNull } from "@beesolve/helpers";
import * as v from "valibot";

import type { Accounts } from "../account.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import { generateOTP } from "../util.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "createNewWithThrottling">;
  readonly accounts: Pick<Accounts, "getOne">;
  readonly events: Pick<Events, "putEvents">;
  readonly baseUri: string;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly requestBody: () => Promise<any>;
  readonly cookies: Record<string, string>;
  readonly acceptLanguage: string | null;
  readonly requestOrigin: string | null;
  /** OTP validity period in seconds. */
  readonly otpExpirySeconds: number;
  /** Cooldown window for resending codes after sign-in. */
  readonly resendCooldownSeconds: number;
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
  resendCooldownSeconds,
}: Dependencies): Promise<Response> {
  const { emailAddress } = parseBody({
    body: await requestBody(),
    schema,
  });

  const account = await accounts.getOne(emailAddress).catch(asNull);

  const token = randomBytes(32).toString("base64url");
  const code = generateOTP();
  const referenceCode = randomBytes(10).toString("base64url");

  const createdAtTimestamp = Date.now();
  const expiresAt = new Date(createdAtTimestamp + otpExpirySeconds * 1000);
  const canResendAt = new Date(createdAtTimestamp + resendCooldownSeconds * 1000);

  await actionTokens.createNewWithThrottling({
    action: "signInRequest",
    data: { emailAddress, accountId: account?.id ?? null },
    expiresAt,
    overwrite: true,
    owner: token,
    remainingUses: 3,
    value: code,
    throttle: { id: emailAddress, windowSeconds: resendCooldownSeconds },
  });

  await events.putEvents({
    type: "EmailCodeAuth",
    detail: {
      code,
      referenceCode,
      emailAddress,
      expiresAt: expiresAt.toISOString(),
      accountId: account?.id ?? null,
      baseUri,
      cookies,
      acceptLanguage,
      requestOrigin,
    },
  });

  return new Response(
    JSON.stringify({
      token,
      referenceCode,
      canResendAt: canResendAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    {
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
      }),
    },
  );
}
