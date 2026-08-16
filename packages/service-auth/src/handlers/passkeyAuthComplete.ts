import { createHash } from "node:crypto";

import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import * as v from "valibot";

import type { Accounts } from "../account.ts";
import { addSetCookies } from "../cookie.ts";
import { BadRequestError, ForbiddenError } from "../errors.ts";
import type { Events } from "../events.ts";
import { verifySignature } from "../passkey/cose.ts";
import { parseAuthenticatorData } from "../passkey/parseAuthData.ts";
import { parseBody } from "../request.ts";
import { Sessions } from "../session.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "use">;
  readonly accounts: Pick<Accounts, "getOne" | "updateCounter">;
  readonly sessions: Pick<Sessions, "createOne">;
  readonly events: Pick<Events, "putEvents">;
  readonly requestBody: () => Promise<unknown>;
  readonly headers: Headers;
  readonly rpId: string;
  readonly baseUri: string;
}

const schema = v.object({
  token: v.string(),
  credentialId: v.string(),
  response: v.object({
    authenticatorData: v.string(),
    clientDataJSON: v.string(),
    signature: v.string(),
  }),
  redirectTo: v.optional(
    v.pipe(
      v.string(),
      v.transform(decodeURIComponent),
      v.regex(/^\/(?!\/)/, "redirectTo must be a relative path"),
    ),
  ),
});

const clientDataSchema = v.object({
  type: v.string(),
  challenge: v.string(),
  origin: v.string(),
});

export async function passkeyAuthComplete({
  actionTokens,
  accounts,
  sessions,
  events,
  requestBody,
  headers,
  rpId,
  baseUri,
}: Dependencies): Promise<Response> {
  const { token, credentialId, response, redirectTo } = parseBody({
    body: await requestBody(),
    schema,
  });

  const clientDataJSONBytes = Buffer.from(response.clientDataJSON, "base64url");
  const clientDataJSON = parseClientDataJSON(clientDataJSONBytes, baseUri);

  await actionTokens.use({
    owner: token,
    action: "passkeyAuth",
    value: clientDataJSON.challenge,
    drainWhenValid: true,
  });

  const account = await accounts.getOne(credentialId, { exact: true });

  if (account.type !== "passkey") {
    throw new BadRequestError("Credential is not a passkey.");
  }

  const authenticatorDataBytes = Buffer.from(response.authenticatorData, "base64url");
  const authData = parseAuthenticatorData(authenticatorDataBytes);

  verifyRpIdHash(authData.rpIdHash, rpId);

  if (!authData.flags.userPresent) {
    throw new BadRequestError("User presence flag not set.");
  }

  const signatureBytes = Buffer.from(response.signature, "base64url");
  const clientDataHash = createHash("sha256").update(clientDataJSONBytes).digest();
  const signedData = Buffer.concat([authenticatorDataBytes, clientDataHash]);

  const isValid = verifySignature({
    publicKeySpki: account.publicKey,
    algorithm: account.algorithm,
    signature: signatureBytes,
    data: signedData,
  });

  if (!isValid) {
    throw new ForbiddenError("Signature verification failed.");
  }

  if (account.counter > 0 && authData.signCount <= account.counter) {
    throw new ForbiddenError("Possible credential cloning detected.");
  }

  await accounts.updateCounter({
    userId: account.id,
    credentialId,
    counter: authData.signCount,
  });

  const session = await sessions.createOne({
    userId: account.id,
    data: Sessions.dataFromCloudFrontHeaders(Object.fromEntries(headers.entries())),
  });

  await events.putEvents(
    { type: "SuccessfulAuth", detail: { userId: account.id } },
    { type: "PasskeyAuthUsed", detail: { userId: account.id, credentialId } },
  );

  if (headers.get("accept")?.includes("application/json")) {
    return new Response(JSON.stringify({ redirectTo: redirectTo ?? "/" }), {
      status: 200,
      headers: addSetCookies({
        headers: new Headers({
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        }),
        cookies: [{ sid: session.id, maxAge: session.maxAge }],
      }),
    });
  }

  return new Response(null, {
    status: 303,
    headers: addSetCookies({
      headers: new Headers({
        "Cache-Control": "no-store",
        Location: redirectTo ?? "/",
      }),
      cookies: [{ sid: session.id, maxAge: session.maxAge }],
    }),
  });
}

function parseClientDataJSON(
  clientDataJSONBytes: Buffer,
  expectedOrigin: string,
): v.InferOutput<typeof clientDataSchema> {
  const jsonString = clientDataJSONBytes.toString("utf-8");
  const data = v.parse(clientDataSchema, JSON.parse(jsonString));

  if (data.type !== "webauthn.get") {
    throw new BadRequestError(
      `Invalid clientDataJSON type: expected "webauthn.get", got "${data.type}".`,
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
