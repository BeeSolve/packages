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
  readonly requestBody: () => Promise<unknown>;
  readonly cookies: Record<string, string>;
  readonly acceptLanguage: string | null;
  readonly requestOrigin: string | null;
  /** OTP validity period in seconds. */
  readonly otpExpirySeconds: number;
  /** Cooldown window for resending codes after sign-in. */
  readonly resendCooldownSeconds: number;
  /**
   * Whether unknown emails are allowed to sign up. When false and the email is
   * not registered, an `UnsuccessfulAuth`/`emailNotRegistered` event is emitted
   * instead of `EmailCodeAuth` — so an unregistered user receives the
   * "not registered" email rather than a code. All other work (token creation,
   * throttling, HTTP response) stays identical to the registered case so the
   * request is not distinguishable by response shape or timing (anti-enumeration).
   */
  readonly allowSignUp: boolean;
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
  allowSignUp,
}: Dependencies): Promise<Response> {
  const { emailAddress } = parseBody({
    body: await requestBody(),
    schema,
  });

  const account = await accounts.getOne({ username: emailAddress }).catch(asNull);

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

  // Emit the "not registered" event instead of a code when sign-up is disabled and
  // the account does not exist. All work above (token creation, throttling) and the
  // response below stay identical to the registered case so the request is not
  // distinguishable by response shape or timing — this prevents email enumeration.
  // The returned token is harmless for an unknown email: signInComplete creates no
  // session when the account is missing and allowSignUp is false.
  if (!allowSignUp && account == null) {
    await events.putEvents({
      type: "UnsuccessfulAuth",
      detail: {
        code: "emailNotRegistered",
        emailAddress,
        reason: "Email not registered.",
      },
    });
  } else {
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
  }

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
        "Content-Type": "application/json",
      }),
    },
  );
}
