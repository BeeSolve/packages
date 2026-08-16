import { describe, expect, test } from "bun:test";

import { parseAuthenticatorData } from "../src/passkey/parseAuthData.ts";

describe("parseAuthenticatorData", () => {
  describe("minimal authData (37 bytes, no attested credential data)", () => {
    test("parses rpIdHash, flags, and signCount", () => {
      const authData = new Uint8Array(37);
      authData.fill(0xaa, 0, 32);
      authData[32] = 0x01;
      authData[33] = 0x00;
      authData[34] = 0x00;
      authData[35] = 0x00;
      authData[36] = 0x05;

      const result = parseAuthenticatorData(authData);

      expect(result.rpIdHash).toEqual(new Uint8Array(32).fill(0xaa));
      expect(result.signCount).toBe(5);
      expect(result.attestedCredentialData).toBeNull();
    });

    test("attestedCredentialData is null when AT flag is not set", () => {
      const authData = new Uint8Array(37);
      authData[32] = 0x05;

      const result = parseAuthenticatorData(authData);

      expect(result.attestedCredentialData).toBeNull();
    });
  });

  describe("flags parsing", () => {
    test("parses userPresent (bit 0)", () => {
      const authData = new Uint8Array(37);
      authData[32] = 0x01;

      const result = parseAuthenticatorData(authData);

      expect(result.flags.userPresent).toBe(true);
      expect(result.flags.userVerified).toBe(false);
      expect(result.flags.backupEligible).toBe(false);
      expect(result.flags.backupState).toBe(false);
      expect(result.flags.attestedCredentialDataIncluded).toBe(false);
      expect(result.flags.extensionDataIncluded).toBe(false);
    });

    test("parses userVerified (bit 2)", () => {
      const authData = new Uint8Array(37);
      authData[32] = 0x04;

      const result = parseAuthenticatorData(authData);

      expect(result.flags.userVerified).toBe(true);
      expect(result.flags.userPresent).toBe(false);
    });

    test("parses backupEligible (bit 3)", () => {
      const authData = new Uint8Array(37);
      authData[32] = 0x08;

      const result = parseAuthenticatorData(authData);

      expect(result.flags.backupEligible).toBe(true);
    });

    test("parses backupState (bit 4)", () => {
      const authData = new Uint8Array(37);
      authData[32] = 0x10;

      const result = parseAuthenticatorData(authData);

      expect(result.flags.backupState).toBe(true);
    });

    test("parses attestedCredentialDataIncluded (bit 6)", () => {
      const authData = buildAuthDataWithCredential();
      const result = parseAuthenticatorData(authData);

      expect(result.flags.attestedCredentialDataIncluded).toBe(true);
    });

    test("parses extensionDataIncluded (bit 7)", () => {
      const authData = new Uint8Array(37);
      authData[32] = 0x80;

      const result = parseAuthenticatorData(authData);

      expect(result.flags.extensionDataIncluded).toBe(true);
    });

    test("parses all flags set (UP + UV + BE + BS + AT + ED = 0xdd)", () => {
      const authData = buildAuthDataWithCredential(0xdd);
      const result = parseAuthenticatorData(authData);

      expect(result.flags.userPresent).toBe(true);
      expect(result.flags.userVerified).toBe(true);
      expect(result.flags.backupEligible).toBe(true);
      expect(result.flags.backupState).toBe(true);
      expect(result.flags.attestedCredentialDataIncluded).toBe(true);
      expect(result.flags.extensionDataIncluded).toBe(true);
    });
  });

  describe("sign count", () => {
    test("parses big-endian sign count", () => {
      const authData = new Uint8Array(37);
      authData[33] = 0x00;
      authData[34] = 0x00;
      authData[35] = 0x01;
      authData[36] = 0x00;

      const result = parseAuthenticatorData(authData);

      expect(result.signCount).toBe(256);
    });

    test("parses maximum sign count (0xFFFFFFFF)", () => {
      const authData = new Uint8Array(37);
      authData[33] = 0xff;
      authData[34] = 0xff;
      authData[35] = 0xff;
      authData[36] = 0xff;

      const result = parseAuthenticatorData(authData);

      expect(result.signCount).toBe(4294967295);
    });

    test("parses zero sign count", () => {
      const authData = new Uint8Array(37);

      const result = parseAuthenticatorData(authData);

      expect(result.signCount).toBe(0);
    });
  });

  describe("attested credential data", () => {
    test("parses AAGUID as UUID string", () => {
      const authData = buildAuthDataWithCredential();
      const result = parseAuthenticatorData(authData);
      const attested = result.attestedCredentialData;

      expect(attested).not.toBeNull();
      expect(attested?.aaguid).toBe("01020304-0506-0708-090a-0b0c0d0e0f10");
    });

    test("formats all-zero AAGUID", () => {
      const authData = buildAuthDataWithCredential(0x41, new Uint8Array(16));
      const result = parseAuthenticatorData(authData);

      expect(result.attestedCredentialData?.aaguid).toBe("00000000-0000-0000-0000-000000000000");
    });

    test("extracts credential ID with correct length", () => {
      const credentialId = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
      const authData = buildAuthDataWithCredential(0x41, undefined, credentialId);
      const result = parseAuthenticatorData(authData);

      expect(result.attestedCredentialData?.credentialId).toEqual(credentialId);
    });

    test("extracts COSE public key from remaining bytes", () => {
      const authData = buildAuthDataWithCredential();
      const result = parseAuthenticatorData(authData);
      const coseKey = result.attestedCredentialData?.credentialPublicKey;

      expect(coseKey).toBeInstanceOf(Map);
      expect(coseKey?.get(1)).toBe(2);
      expect(coseKey?.get(3)).toBe(-7);
      expect(coseKey?.get(-1)).toBe(1);
      expect(coseKey?.get(-2)).toBeInstanceOf(Uint8Array);
      expect(coseKey?.get(-3)).toBeInstanceOf(Uint8Array);
    });

    test("handles long credential ID", () => {
      const credentialId = new Uint8Array(64).fill(0x42);
      const authData = buildAuthDataWithCredential(0x41, undefined, credentialId);
      const result = parseAuthenticatorData(authData);

      expect(result.attestedCredentialData?.credentialId).toEqual(credentialId);
      expect(result.attestedCredentialData?.credentialId.length).toBe(64);
    });
  });

  describe("error cases", () => {
    test("throws for data shorter than 37 bytes", () => {
      const authData = new Uint8Array(36);

      expect(() => parseAuthenticatorData(authData)).toThrow("data too short");
    });

    test("throws for empty data", () => {
      const authData = new Uint8Array(0);

      expect(() => parseAuthenticatorData(authData)).toThrow("data too short");
    });

    test("throws for truncated attested credential data (missing AAGUID)", () => {
      const authData = new Uint8Array(40);
      authData[32] = 0x40;

      expect(() => parseAuthenticatorData(authData)).toThrow("truncated attested credential data");
    });

    test("throws for truncated credential ID", () => {
      const authData = new Uint8Array(57);
      authData[32] = 0x40;
      authData[53] = 0x00;
      authData[54] = 0x20;

      expect(() => parseAuthenticatorData(authData)).toThrow("truncated credential ID");
    });
  });
});

function buildCoseKeyBytes(): Uint8Array {
  const cborMap = new Uint8Array([
    0xa5,
    0x01,
    0x02,
    0x03,
    0x26,
    0x20,
    0x01,
    0x21,
    0x58,
    0x20,
    ...new Uint8Array(32).fill(0x11),
    0x22,
    0x58,
    0x20,
    ...new Uint8Array(32).fill(0x22),
  ]);
  return cborMap;
}

function buildAuthDataWithCredential(
  flags = 0x41,
  aaguid?: Uint8Array,
  credentialId?: Uint8Array,
): Uint8Array {
  const rpIdHash = new Uint8Array(32).fill(0x00);
  const signCount = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
  const aaguidBytes =
    aaguid ??
    new Uint8Array([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
      0x10,
    ]);
  const credId = credentialId ?? new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
  const credIdLength = new Uint8Array(2);
  credIdLength[0] = (credId.length >> 8) & 0xff;
  credIdLength[1] = credId.length & 0xff;
  const coseKeyBytes = buildCoseKeyBytes();

  const totalLength =
    rpIdHash.length +
    1 +
    signCount.length +
    aaguidBytes.length +
    credIdLength.length +
    credId.length +
    coseKeyBytes.length;

  const authData = new Uint8Array(totalLength);
  let offset = 0;

  authData.set(rpIdHash, offset);
  offset += rpIdHash.length;

  authData[offset] = flags;
  offset += 1;

  authData.set(signCount, offset);
  offset += signCount.length;

  authData.set(aaguidBytes, offset);
  offset += aaguidBytes.length;

  authData.set(credIdLength, offset);
  offset += credIdLength.length;

  authData.set(credId, offset);
  offset += credId.length;

  authData.set(coseKeyBytes, offset);

  return authData;
}
