import { decodeCbor } from "./cbor.ts";

export interface AuthenticatorFlags {
  readonly userPresent: boolean;
  readonly userVerified: boolean;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly attestedCredentialDataIncluded: boolean;
  readonly extensionDataIncluded: boolean;
}

export interface AttestedCredentialData {
  readonly aaguid: string;
  readonly credentialId: Uint8Array;
  readonly credentialPublicKey: Map<number | string, unknown>;
}

export interface AuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly flags: AuthenticatorFlags;
  readonly signCount: number;
  readonly attestedCredentialData: AttestedCredentialData | null;
}

export function parseAuthenticatorData(authData: Uint8Array): AuthenticatorData {
  if (authData.length < 37) {
    throw new Error("AuthenticatorData: data too short (minimum 37 bytes)");
  }

  const rpIdHash = authData.slice(0, 32);
  // Safe: length >= 37 is guaranteed by the check above
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const flagsByte = authData[32]!;
  const flags = parseFlags(flagsByte);

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const signCount = view.getUint32(33);

  let attestedCredentialData: AttestedCredentialData | null = null;

  if (flags.attestedCredentialDataIncluded) {
    attestedCredentialData = parseAttestedCredentialData(authData, 37);
  }

  return { rpIdHash, flags, signCount, attestedCredentialData };
}

function parseFlags(flagsByte: number): AuthenticatorFlags {
  return {
    userPresent: (flagsByte & 0x01) !== 0,
    userVerified: (flagsByte & 0x04) !== 0,
    backupEligible: (flagsByte & 0x08) !== 0,
    backupState: (flagsByte & 0x10) !== 0,
    attestedCredentialDataIncluded: (flagsByte & 0x40) !== 0,
    extensionDataIncluded: (flagsByte & 0x80) !== 0,
  };
}

function parseAttestedCredentialData(authData: Uint8Array, offset: number): AttestedCredentialData {
  if (authData.length < offset + 18) {
    throw new Error("AuthenticatorData: truncated attested credential data");
  }

  const aaguidBytes = authData.slice(offset, offset + 16);
  const aaguid = formatAaguid(aaguidBytes);

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const credentialIdLength = view.getUint16(offset + 16);

  const credentialIdStart = offset + 18;
  const credentialIdEnd = credentialIdStart + credentialIdLength;

  if (authData.length < credentialIdEnd) {
    throw new Error("AuthenticatorData: truncated credential ID");
  }

  const credentialId = authData.slice(credentialIdStart, credentialIdEnd);

  const coseKeyBytes = authData.slice(credentialIdEnd);
  if (coseKeyBytes.length === 0) {
    throw new Error("AuthenticatorData: missing COSE public key data");
  }

  const credentialPublicKey = decodeCbor(coseKeyBytes);
  if (!(credentialPublicKey instanceof Map)) {
    throw new Error("AuthenticatorData: COSE public key is not a map");
  }

  return { aaguid, credentialId, credentialPublicKey };
}

function formatAaguid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
