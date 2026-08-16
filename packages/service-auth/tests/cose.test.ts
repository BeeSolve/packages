import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";

import { coseKeyToPublicKey, verifySignature } from "../src/passkey/cose.ts";

describe("coseKeyToPublicKey", () => {
  describe("EC2 P-256 (ES256)", () => {
    test("converts a valid P-256 key to SPKI/DER base64url", () => {
      const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const uncompressedPoint = spkiDer.subarray(26);

      const x = uncompressedPoint.subarray(1, 33);
      const y = uncompressedPoint.subarray(33, 65);

      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(x)],
        [-3, new Uint8Array(y)],
      ]);

      const result = coseKeyToPublicKey(coseMap);

      expect(result.algorithm).toBe(-7);
      const expectedSpki = Buffer.from(spkiDer).toString("base64url");
      expect(result.publicKeySpki).toBe(expectedSpki);
    });

    test("produces a key that Node.js can import", () => {
      const x = new Uint8Array(32).fill(0xab);
      const y = new Uint8Array(32).fill(0xcd);

      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]);

      const result = coseKeyToPublicKey(coseMap);
      const derBytes = Buffer.from(result.publicKeySpki, "base64url");

      expect(derBytes.length).toBe(91);
      expect(derBytes[0]).toBe(0x30);
    });

    test("throws for invalid algorithm", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -35],
        [-1, 1],
        [-2, new Uint8Array(32)],
        [-3, new Uint8Array(32)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow("unsupported algorithm for EC2 key");
    });

    test("throws for invalid curve", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 2],
        [-2, new Uint8Array(32)],
        [-3, new Uint8Array(32)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow("unsupported curve for EC2 key");
    });

    test("throws when x coordinate is missing", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-3, new Uint8Array(32)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow(
        "EC2 x coordinate must be a 32-byte Uint8Array",
      );
    });

    test("throws when y coordinate is wrong length", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(32)],
        [-3, new Uint8Array(16)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow(
        "EC2 y coordinate must be a 32-byte Uint8Array",
      );
    });

    test("throws when x coordinate is not Uint8Array", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, "not bytes"],
        [-3, new Uint8Array(32)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow(
        "EC2 x coordinate must be a 32-byte Uint8Array",
      );
    });
  });

  describe("OKP Ed25519 (EdDSA)", () => {
    test("converts a valid Ed25519 key to SPKI/DER base64url", () => {
      const keyPair = crypto.generateKeyPairSync("ed25519");
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const publicKeyBytes = spkiDer.subarray(12);

      const coseMap = new Map<number | string, unknown>([
        [1, 1],
        [3, -8],
        [-1, 6],
        [-2, new Uint8Array(publicKeyBytes)],
      ]);

      const result = coseKeyToPublicKey(coseMap);

      expect(result.algorithm).toBe(-8);
      const expectedSpki = Buffer.from(spkiDer).toString("base64url");
      expect(result.publicKeySpki).toBe(expectedSpki);
    });

    test("throws for invalid algorithm on OKP key", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 1],
        [3, -7],
        [-1, 6],
        [-2, new Uint8Array(32)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow("unsupported algorithm for OKP key");
    });

    test("throws for invalid curve on OKP key", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 1],
        [3, -8],
        [-1, 4],
        [-2, new Uint8Array(32)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow("unsupported curve for OKP key");
    });

    test("throws when public key is wrong length", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 1],
        [3, -8],
        [-1, 6],
        [-2, new Uint8Array(48)],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow(
        "Ed25519 public key must be a 32-byte Uint8Array",
      );
    });
  });

  describe("unsupported key types", () => {
    test("throws for unsupported kty", () => {
      const coseMap = new Map<number | string, unknown>([
        [1, 3],
        [3, -7],
      ]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow("unsupported key type (kty): 3");
    });

    test("throws for undefined kty", () => {
      const coseMap = new Map<number | string, unknown>([[3, -7]]);

      expect(() => coseKeyToPublicKey(coseMap)).toThrow("unsupported key type (kty)");
    });
  });
});

describe("verifySignature", () => {
  describe("ES256 (P-256)", () => {
    test("verifies a valid signature", () => {
      const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const publicKeySpki = Buffer.from(spkiDer).toString("base64url");

      const data = Buffer.from("test data for signing");
      const signature = crypto.sign("SHA256", data, keyPair.privateKey);

      const result = verifySignature({
        publicKeySpki,
        algorithm: -7,
        signature: new Uint8Array(signature),
        data: new Uint8Array(data),
      });

      expect(result).toBe(true);
    });

    test("returns false for wrong data", () => {
      const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const publicKeySpki = Buffer.from(spkiDer).toString("base64url");

      const data = Buffer.from("original data");
      const signature = crypto.sign("SHA256", data, keyPair.privateKey);

      const result = verifySignature({
        publicKeySpki,
        algorithm: -7,
        signature: new Uint8Array(signature),
        data: new Uint8Array(Buffer.from("tampered data")),
      });

      expect(result).toBe(false);
    });

    test("returns false for wrong signature", () => {
      const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const publicKeySpki = Buffer.from(spkiDer).toString("base64url");

      const data = Buffer.from("test data");
      const badSignature = new Uint8Array(64).fill(0xff);

      const result = verifySignature({
        publicKeySpki,
        algorithm: -7,
        signature: badSignature,
        data: new Uint8Array(data),
      });

      expect(result).toBe(false);
    });
  });

  describe("EdDSA (Ed25519)", () => {
    test("verifies a valid signature", () => {
      const keyPair = crypto.generateKeyPairSync("ed25519");
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const publicKeySpki = Buffer.from(spkiDer).toString("base64url");

      const data = Buffer.from("test data for ed25519 signing");
      const signature = crypto.sign(null, data, keyPair.privateKey);

      const result = verifySignature({
        publicKeySpki,
        algorithm: -8,
        signature: new Uint8Array(signature),
        data: new Uint8Array(data),
      });

      expect(result).toBe(true);
    });

    test("returns false for wrong data", () => {
      const keyPair = crypto.generateKeyPairSync("ed25519");
      const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
      const publicKeySpki = Buffer.from(spkiDer).toString("base64url");

      const data = Buffer.from("original data");
      const signature = crypto.sign(null, data, keyPair.privateKey);

      const result = verifySignature({
        publicKeySpki,
        algorithm: -8,
        signature: new Uint8Array(signature),
        data: new Uint8Array(Buffer.from("tampered data")),
      });

      expect(result).toBe(false);
    });
  });

  test("throws for unsupported algorithm", () => {
    const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
    const publicKeySpki = Buffer.from(spkiDer).toString("base64url");

    expect(() =>
      verifySignature({
        publicKeySpki,
        algorithm: -35,
        signature: new Uint8Array(64),
        data: new Uint8Array(32),
      }),
    ).toThrow("unsupported algorithm for verification");
  });

  test("round-trip: coseKeyToPublicKey output works with verifySignature", () => {
    const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spkiDer = keyPair.publicKey.export({ type: "spki", format: "der" });
    const uncompressedPoint = spkiDer.subarray(26);
    const x = uncompressedPoint.subarray(1, 33);
    const y = uncompressedPoint.subarray(33, 65);

    const coseMap = new Map<number | string, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(x)],
      [-3, new Uint8Array(y)],
    ]);

    const cosePublicKey = coseKeyToPublicKey(coseMap);
    const data = Buffer.from("round trip test data");
    const signature = crypto.sign("SHA256", data, keyPair.privateKey);

    const result = verifySignature({
      publicKeySpki: cosePublicKey.publicKeySpki,
      algorithm: cosePublicKey.algorithm,
      signature: new Uint8Array(signature),
      data: new Uint8Array(data),
    });

    expect(result).toBe(true);
  });
});
