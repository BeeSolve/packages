import { randomBytes } from "node:crypto";

import {
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
  TokenDoesNotExistError,
} from "@beesolve/action-tokens/model";
import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import * as v from "valibot";

import { BadRequestError } from "../errors.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import { generateOTP } from "../util.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "peek" | "drain" | "createNewWithThrottling">;
  readonly events: Pick<Events, "putEvents">;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly requestBody: () => Promise<any>;
  readonly otpExpirySeconds: number;
  readonly resendCooldownSeconds: number;
  readonly drainOnResend: boolean;
  readonly baseUri: string;
  readonly cookies: Record<string, string>;
  readonly acceptLanguage: string | null;
  readonly requestOrigin: string | null;
}

const schema = v.object({
  token: v.pipe(v.string(), v.nonEmpty(), v.maxLength(256)),
});

/**
 * Handles the resending of a code for an existing token owner.
 * This process peeks, optionally drains the old token, and creates a new one with throttling enforced.
 */
export async function resendCode({
  actionTokens,
  events,
  requestBody,
  otpExpirySeconds,
  resendCooldownSeconds,
  drainOnResend,
  baseUri,
  cookies,
  acceptLanguage,
  requestOrigin,
}: Dependencies): Promise<Response> {
  const { token: oldToken } = parseBody({ body: await requestBody(), schema });

  const { data } = await actionTokens
    .peek({
      owner: oldToken,
      action: "signInRequest",
    })
    .catch((error) => {
      if (
        error instanceof TokenDoesNotExistError ||
        error instanceof ExpiredTokenError ||
        error instanceof TokenAlreadyUsedUpError
      ) {
        throw new BadRequestError("Token not found or expired.");
      }
      throw error;
    });

  const result = v.safeParse(
    v.object({ emailAddress: v.pipe(v.string(), v.email()), accountId: v.nullable(v.string()) }),
    data,
  );
  if (!result.success) throw new BadRequestError("Invalid token.");

  if (drainOnResend) {
    await actionTokens.drain({ owner: oldToken, action: "signInRequest" });
  }

  const newToken = randomBytes(32).toString("base64url");
  const code = generateOTP();
  const referenceCode = randomBytes(10).toString("base64url");

  const createdAtTimestamp = Date.now();
  const expiresAt = new Date(createdAtTimestamp + otpExpirySeconds * 1000);
  const canResendAt = new Date(createdAtTimestamp + resendCooldownSeconds * 1000);

  await actionTokens.createNewWithThrottling({
    action: "signInRequest",
    data: { emailAddress: result.output.emailAddress, accountId: result.output.accountId },
    expiresAt,
    overwrite: false,
    owner: newToken,
    remainingUses: 3,
    value: code,
    throttle: { id: result.output.emailAddress, windowSeconds: resendCooldownSeconds },
  });

  await events.putEvents({
    type: "EmailCodeAuth",
    detail: {
      code,
      referenceCode,
      emailAddress: result.output.emailAddress,
      expiresAt: expiresAt.toISOString(),
      accountId: result.output.accountId,
      baseUri: baseUri,
      cookies: cookies,
      acceptLanguage: acceptLanguage,
      requestOrigin: requestOrigin,
    },
  });

  return new Response(
    JSON.stringify({
      token: newToken,
      referenceCode,
      canResendAt: canResendAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}
