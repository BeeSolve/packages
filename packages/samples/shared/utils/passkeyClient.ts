import * as v from "valibot";

import { AuthError } from "./authClient.ts";

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const authErrorSchema = v.object({
  type: v.string(),
  message: v.optional(v.string()),
});

const credentialDescriptorSchema = v.object({
  id: v.string(),
  type: v.literal("public-key"),
  transports: v.optional(v.array(v.string())),
});

const registerOptionsSchema = v.object({
  token: v.string(),
  publicKey: v.object({
    rp: v.object({
      name: v.string(),
      id: v.optional(v.string()),
    }),
    user: v.object({
      id: v.string(),
      name: v.string(),
      displayName: v.string(),
    }),
    challenge: v.string(),
    pubKeyCredParams: v.array(
      v.object({
        type: v.literal("public-key"),
        alg: v.number(),
      }),
    ),
    authenticatorSelection: v.optional(
      v.object({
        authenticatorAttachment: v.optional(v.string()),
        residentKey: v.optional(v.string()),
        requireResidentKey: v.optional(v.boolean()),
        userVerification: v.optional(v.string()),
      }),
    ),
    attestation: v.optional(v.string()),
    timeout: v.optional(v.number()),
    excludeCredentials: v.optional(v.array(credentialDescriptorSchema)),
  }),
});

const registerCompleteSchema = v.object({
  success: v.literal(true),
  credentialId: v.string(),
});

const authOptionsSchema = v.object({
  token: v.string(),
  publicKey: v.object({
    rpId: v.optional(v.string()),
    challenge: v.string(),
    allowCredentials: v.optional(v.array(credentialDescriptorSchema)),
    userVerification: v.optional(v.string()),
    timeout: v.optional(v.number()),
  }),
});

const authCompleteSchema = v.object({
  redirectTo: v.string(),
});

async function postJson<T>(
  path: string,
  body: unknown,
  schema: v.GenericSchema<unknown, T>,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let type = "unknown";
    try {
      const errorData = v.parse(authErrorSchema, await response.json());
      type = errorData.type;
    } catch {
      // ignore parse failure, use default type
    }
    throw new AuthError(response.status, type);
  }

  const data = await response.json();
  return v.parse(schema, data);
}

export async function registerPasskey(displayName?: string): Promise<{ credentialId: string }> {
  const options = await postJson(
    "/auth/passkey/registerOptions",
    { displayName },
    registerOptionsSchema,
  );

  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    rp: options.publicKey.rp,
    user: {
      id: base64urlToBuffer(options.publicKey.user.id),
      name: options.publicKey.user.name,
      displayName: options.publicKey.user.displayName,
    },
    challenge: base64urlToBuffer(options.publicKey.challenge),
    pubKeyCredParams: options.publicKey.pubKeyCredParams,
    authenticatorSelection: options.publicKey.authenticatorSelection as
      | AuthenticatorSelectionCriteria
      | undefined,
    attestation: options.publicKey.attestation as AttestationConveyancePreference | undefined,
    timeout: options.publicKey.timeout,
    excludeCredentials: options.publicKey.excludeCredentials?.map((credential) => ({
      id: base64urlToBuffer(credential.id),
      type: credential.type,
      transports: credential.transports as Array<AuthenticatorTransport> | undefined,
    })),
  };

  const credential = (await navigator.credentials.create({
    publicKey: publicKeyOptions,
  })) as PublicKeyCredential | null;
  if (credential == null) {
    throw new AuthError(
      0,
      "credential_creation_failed",
      "Passkey registration was cancelled or failed",
    );
  }

  const attestationResponse = credential.response as AuthenticatorAttestationResponse;

  const result = await postJson(
    "/auth/passkey/registerComplete",
    {
      token: options.token,
      response: {
        attestationObject: bufferToBase64url(attestationResponse.attestationObject),
        clientDataJSON: bufferToBase64url(attestationResponse.clientDataJSON),
        transports: attestationResponse.getTransports?.() ?? [],
      },
    },
    registerCompleteSchema,
  );

  return { credentialId: result.credentialId };
}

export async function signInWithPasskey(): Promise<void> {
  const options = await postJson("/auth/passkey/authOptions", {}, authOptionsSchema);

  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    rpId: options.publicKey.rpId,
    challenge: base64urlToBuffer(options.publicKey.challenge),
    allowCredentials: options.publicKey.allowCredentials?.map((credential) => ({
      id: base64urlToBuffer(credential.id),
      type: credential.type,
      transports: credential.transports as Array<AuthenticatorTransport> | undefined,
    })),
    userVerification: options.publicKey.userVerification as UserVerificationRequirement | undefined,
    timeout: options.publicKey.timeout,
  };

  const credential = (await navigator.credentials.get({
    publicKey: publicKeyOptions,
  })) as PublicKeyCredential | null;
  if (credential == null) {
    throw new AuthError(
      0,
      "credential_get_failed",
      "Passkey authentication was cancelled or failed",
    );
  }

  const assertionResponse = credential.response as AuthenticatorAssertionResponse;

  const result = await postJson(
    "/auth/passkey/authComplete",
    {
      token: options.token,
      credentialId: credential.id,
      response: {
        authenticatorData: bufferToBase64url(assertionResponse.authenticatorData),
        clientDataJSON: bufferToBase64url(assertionResponse.clientDataJSON),
        signature: bufferToBase64url(assertionResponse.signature),
      },
    },
    authCompleteSchema,
  );

  window.location.href = result.redirectTo;
}
