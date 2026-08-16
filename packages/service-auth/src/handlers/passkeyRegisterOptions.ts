import { randomBytes } from "node:crypto";

import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import * as v from "valibot";

import type { Accounts } from "../account.ts";
import { parseBody } from "../request.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "createNew">;
  readonly accounts: Pick<Accounts, "getPasskeysByUserId">;
  readonly requestBody: () => Promise<unknown>;
  readonly userId: string;
  readonly rpId: string;
  readonly rpName: string;
  readonly baseUri: string;
}

const schema = v.object({
  displayName: v.optional(v.string()),
});

export async function passkeyRegisterOptions({
  actionTokens,
  accounts,
  requestBody,
  userId,
  rpId,
  rpName,
}: Dependencies): Promise<Response> {
  const { displayName } = parseBody({
    body: await requestBody(),
    schema,
  });

  const existingPasskeys = await accounts.getPasskeysByUserId(userId);

  const excludeCredentials = existingPasskeys.map((passkey) => ({
    id: passkey.username,
    type: "public-key" as const,
    transports: passkey.transports,
  }));

  const challenge = randomBytes(32).toString("base64url");
  const token = randomBytes(32).toString("base64url");

  const timeoutInSeconds = 300_000;

  await actionTokens.createNew({
    owner: token,
    action: "passkeyRegister",
    value: challenge,
    remainingUses: 1,
    expiresAt: new Date(Date.now() + timeoutInSeconds),
    data: { userId },
    overwrite: false,
  });

  return new Response(
    JSON.stringify({
      token,
      publicKey: {
        rp: { id: rpId, name: rpName },
        user: {
          id: Buffer.from(userId).toString("base64url"),
          name: userId,
          displayName: displayName ?? userId,
        },
        challenge,
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -8 },
        ],
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        attestation: "none",
        timeout: timeoutInSeconds,
        excludeCredentials,
      },
    }),
    {
      status: 200,
      headers: new Headers({
        "Content-Type": "application/json",
      }),
    },
  );
}
