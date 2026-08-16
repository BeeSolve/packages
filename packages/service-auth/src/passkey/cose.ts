import crypto from "node:crypto";

export interface CosePublicKey {
  /** Base64url-encoded SPKI/DER public key for storage */
  readonly publicKeySpki: string;
  /** The COSE algorithm identifier (e.g. -7 for ES256) */
  readonly algorithm: number;
}

export function coseKeyToPublicKey(coseMap: Map<number | string, unknown>): CosePublicKey {
  const kty = coseMap.get(1);
  const alg = coseMap.get(3);

  if (kty === 2) {
    return parseEc2Key(coseMap, alg);
  }

  if (kty === 1) {
    return parseOkpKey(coseMap, alg);
  }

  throw new Error(`COSE: unsupported key type (kty): ${String(kty)}`);
}

export function verifySignature(props: {
  readonly publicKeySpki: string;
  readonly algorithm: number;
  readonly signature: Uint8Array;
  readonly data: Uint8Array;
}): boolean {
  const derBytes = Buffer.from(props.publicKeySpki, "base64url");
  const keyObject = crypto.createPublicKey({ key: derBytes, format: "der", type: "spki" });

  if (props.algorithm === -7) {
    return crypto.verify("SHA256", props.data, keyObject, props.signature);
  }

  if (props.algorithm === -8) {
    return crypto.verify(null, props.data, keyObject, props.signature);
  }

  throw new Error(`COSE: unsupported algorithm for verification: ${props.algorithm}`);
}

const ecP256SpkiPrefix = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

const ed25519SpkiPrefix = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function parseEc2Key(coseMap: Map<number | string, unknown>, alg: unknown): CosePublicKey {
  if (alg !== -7) {
    throw new Error(
      `COSE: unsupported algorithm for EC2 key: ${String(alg)} (expected -7 for ES256)`,
    );
  }

  const crv = coseMap.get(-1);
  if (crv !== 1) {
    throw new Error(`COSE: unsupported curve for EC2 key: ${String(crv)} (expected 1 for P-256)`);
  }

  const x = coseMap.get(-2);
  const y = coseMap.get(-3);

  if (!(x instanceof Uint8Array) || x.length !== 32) {
    throw new Error("COSE: EC2 x coordinate must be a 32-byte Uint8Array");
  }

  if (!(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error("COSE: EC2 y coordinate must be a 32-byte Uint8Array");
  }

  const uncompressedPoint = new Uint8Array(65);
  uncompressedPoint[0] = 0x04;
  uncompressedPoint.set(x, 1);
  uncompressedPoint.set(y, 33);

  const spkiDer = new Uint8Array(ecP256SpkiPrefix.length + uncompressedPoint.length);
  spkiDer.set(ecP256SpkiPrefix);
  spkiDer.set(uncompressedPoint, ecP256SpkiPrefix.length);

  return {
    publicKeySpki: Buffer.from(spkiDer).toString("base64url"),
    algorithm: -7,
  };
}

function parseOkpKey(coseMap: Map<number | string, unknown>, alg: unknown): CosePublicKey {
  if (alg !== -8) {
    throw new Error(
      `COSE: unsupported algorithm for OKP key: ${String(alg)} (expected -8 for EdDSA)`,
    );
  }

  const crv = coseMap.get(-1);
  if (crv !== 6) {
    throw new Error(`COSE: unsupported curve for OKP key: ${String(crv)} (expected 6 for Ed25519)`);
  }

  const x = coseMap.get(-2);

  if (!(x instanceof Uint8Array) || x.length !== 32) {
    throw new Error("COSE: Ed25519 public key must be a 32-byte Uint8Array");
  }

  const spkiDer = new Uint8Array(ed25519SpkiPrefix.length + x.length);
  spkiDer.set(ed25519SpkiPrefix);
  spkiDer.set(x, ed25519SpkiPrefix.length);

  return {
    publicKeySpki: Buffer.from(spkiDer).toString("base64url"),
    algorithm: -8,
  };
}
