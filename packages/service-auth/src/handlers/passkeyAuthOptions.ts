import { randomBytes } from "node:crypto";

import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import * as v from "valibot";

import type { Accounts } from "../account.ts";
import { parseBody } from "../request.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "createNew">;
  readonly accounts: Pick<Accounts, "getPasskeysByUserId">;
  readonly requestBody: () => Promise<unknown>;
  readonly rpId: string;
}

const schema = v.object({
  userId: v.optional(v.string()),
});

export async function passkeyAuthOptions({
  actionTokens,
  accounts,
  requestBody,
  rpId,
}: Dependencies): Promise<Response> {
  const { userId } = parseBody({
    body: await requestBody(),
    schema,
  });

  const challenge = randomBytes(32).toString("base64url");
  const token = randomBytes(32).toString("base64url");

  const allowCredentials = await getAllowCredentials({ accounts, userId });

  const timeoutInSeconds = 300_000;

  await actionTokens.createNew({
    owner: token,
    action: "passkeyAuth",
    value: challenge,
    remainingUses: 1,
    expiresAt: new Date(Date.now() + timeoutInSeconds),
    data: undefined,
    overwrite: false,
  });

  return new Response(
    JSON.stringify({
      token,
      publicKey: {
        rpId,
        challenge,
        allowCredentials,
        userVerification: "preferred",
        timeout: timeoutInSeconds,
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

interface AllowCredentialsProps {
  readonly accounts: Pick<Accounts, "getPasskeysByUserId">;
  readonly userId: string | undefined;
}

async function getAllowCredentials({ accounts, userId }: AllowCredentialsProps) {
  if (userId == null) return [];

  const passkeys = await accounts.getPasskeysByUserId(userId);
  return passkeys.map((passkey) => ({
    id: passkey.username,
    type: "public-key" as const,
    transports: passkey.transports,
  }));
}
