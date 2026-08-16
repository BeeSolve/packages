import { createHash } from "node:crypto";

import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import * as v from "valibot";

import type { Accounts } from "../account.ts";
import { BadRequestError, ForbiddenError } from "../errors.ts";
import type { Events } from "../events.ts";
import { coseKeyToPublicKey } from "../passkey/cose.ts";
import { parseAuthenticatorData } from "../passkey/parseAuthData.ts";
import { parseBody } from "../request.ts";
import { decodeAttestationObject } from "./passkeyRegisterComplete/decodeAttestation.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "use">;
  readonly accounts: Pick<Accounts, "createPasskey">;
  readonly events: Pick<Events, "putEvents">;
  readonly requestBody: () => Promise<unknown>;
  readonly userId: string;
  readonly rpId: string;
  readonly baseUri: string;
}

const schema = v.object({
  token: v.string(),
  response: v.object({
    attestationObject: v.string(),
    clientDataJSON: v.string(),
    transports: v.optional(v.array(v.string()), []),
  }),
});

const tokenDataSchema = v.object({
  userId: v.string(),
});

const clientDataSchema = v.object({
  type: v.string(),
  challenge: v.string(),
  origin: v.string(),
});

export async function passkeyRegisterComplete({
  actionTokens,
  accounts,
  events,
  requestBody,
  userId,
  rpId,
  baseUri,
}: Dependencies): Promise<Response> {
  const { token, response } = parseBody({
    body: await requestBody(),
    schema,
  });

  const clientDataJSON = parseClientDataJSON(response.clientDataJSON, baseUri);

  const tokenResult = await actionTokens.use({
    owner: token,
    action: "passkeyRegister",
    value: clientDataJSON.challenge,
    drainWhenValid: true,
  });

  if (tokenResult.data == null) {
    throw new BadRequestError("Invalid or expired registration token.");
  }

  const tokenData = v.parse(tokenDataSchema, tokenResult.data);
  if (tokenData.userId !== userId) {
    throw new ForbiddenError("Registration token does not belong to this user.");
  }

  const attestationObject = decodeAttestationObject(response.attestationObject);
  const authData = parseAuthenticatorData(attestationObject.authData);

  verifyRpIdHash(authData.rpIdHash, rpId);

  if (!authData.flags.userPresent) {
    throw new BadRequestError("User presence flag not set.");
  }
  if (!authData.flags.userVerified) {
    throw new BadRequestError("User verification flag not set.");
  }
  if (!authData.flags.attestedCredentialDataIncluded) {
    throw new BadRequestError("Attested credential data not included.");
  }
  if (authData.attestedCredentialData == null) {
    throw new BadRequestError("Missing attested credential data.");
  }

  const credentialId = Buffer.from(authData.attestedCredentialData.credentialId).toString(
    "base64url",
  );
  const publicKey = coseKeyToPublicKey(authData.attestedCredentialData.credentialPublicKey);

  await accounts.createPasskey({
    id: userId,
    credentialId,
    publicKey: publicKey.publicKeySpki,
    counter: authData.signCount,
    transports: response.transports,
    aaguid: authData.attestedCredentialData.aaguid,
    backedUp: authData.flags.backupState,
    algorithm: publicKey.algorithm,
  });

  await events.putEvents({
    type: "PasskeyRegistered",
    detail: {
      userId,
      credentialId,
    },
  });

  return new Response(
    JSON.stringify({
      success: true,
      credentialId,
    }),
    {
      status: 200,
      headers: new Headers({
        "Content-Type": "application/json",
      }),
    },
  );
}

function parseClientDataJSON(
  clientDataBase64url: string,
  expectedOrigin: string,
): v.InferOutput<typeof clientDataSchema> {
  const jsonString = Buffer.from(clientDataBase64url, "base64url").toString("utf-8");
  const data = v.parse(clientDataSchema, JSON.parse(jsonString));

  if (data.type !== "webauthn.create") {
    throw new BadRequestError(
      `Invalid clientDataJSON type: expected "webauthn.create", got "${data.type}".`,
    );
  }

  if (data.origin !== expectedOrigin) {
    throw new BadRequestError(
      `Invalid clientDataJSON origin: expected "${expectedOrigin}", got "${data.origin}".`,
    );
  }

  return data;
}

function verifyRpIdHash(rpIdHash: Uint8Array, rpId: string): void {
  const expectedHash = createHash("sha256").update(rpId).digest();

  if (!Buffer.from(rpIdHash).equals(expectedHash)) {
    throw new BadRequestError("RP ID hash mismatch.");
  }
}
