import { decodeCbor } from "../../passkey/cbor.ts";

interface AttestationObject {
  readonly fmt: string;
  readonly authData: Uint8Array;
  readonly attStmt: unknown;
}

export function decodeAttestationObject(attestationObjectBase64url: string): AttestationObject {
  const bytes = Buffer.from(attestationObjectBase64url, "base64url");
  const decoded = decodeCbor(new Uint8Array(bytes));

  if (!(decoded instanceof Map)) {
    throw new Error("AttestationObject: CBOR-decoded value is not a map.");
  }

  const fmt = decoded.get("fmt");
  if (typeof fmt !== "string") {
    throw new Error("AttestationObject: missing or invalid 'fmt' field.");
  }

  const authData = decoded.get("authData");
  if (!(authData instanceof Uint8Array)) {
    throw new Error("AttestationObject: missing or invalid 'authData' field.");
  }

  const attStmt = decoded.get("attStmt");

  return { fmt, authData, attStmt };
}
