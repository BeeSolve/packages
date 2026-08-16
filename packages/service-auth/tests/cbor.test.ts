import { describe, expect, test } from "bun:test";

import { decodeCbor } from "../src/passkey/cbor.ts";

describe("decodeCbor", () => {
  describe("unsigned integers (major type 0)", () => {
    test("decodes single-byte integer 0", () => {
      expect(decodeCbor(new Uint8Array([0x00]))).toBe(0);
    });

    test("decodes single-byte integer 23", () => {
      expect(decodeCbor(new Uint8Array([0x17]))).toBe(23);
    });

    test("decodes 1-byte argument integer 24", () => {
      expect(decodeCbor(new Uint8Array([0x18, 0x18]))).toBe(24);
    });

    test("decodes 1-byte argument integer 255", () => {
      expect(decodeCbor(new Uint8Array([0x18, 0xff]))).toBe(255);
    });

    test("decodes 2-byte integer 256", () => {
      expect(decodeCbor(new Uint8Array([0x19, 0x01, 0x00]))).toBe(256);
    });

    test("decodes 2-byte integer 65535", () => {
      expect(decodeCbor(new Uint8Array([0x19, 0xff, 0xff]))).toBe(65535);
    });

    test("decodes 4-byte integer 65536", () => {
      expect(decodeCbor(new Uint8Array([0x1a, 0x00, 0x01, 0x00, 0x00]))).toBe(65536);
    });

    test("decodes 4-byte integer 1000000", () => {
      expect(decodeCbor(new Uint8Array([0x1a, 0x00, 0x0f, 0x42, 0x40]))).toBe(1000000);
    });
  });

  describe("negative integers (major type 1)", () => {
    test("decodes -1", () => {
      expect(decodeCbor(new Uint8Array([0x20]))).toBe(-1);
    });

    test("decodes -7 (COSE ES256 algorithm identifier)", () => {
      // -7 is encoded as major type 1, value 6 → 0x26
      expect(decodeCbor(new Uint8Array([0x26]))).toBe(-7);
    });

    test("decodes -25", () => {
      // -25 = -1 - 24, additional info 24 with argument 24
      expect(decodeCbor(new Uint8Array([0x38, 0x18]))).toBe(-25);
    });

    test("decodes -257 (2-byte)", () => {
      // -257 = -1 - 256
      expect(decodeCbor(new Uint8Array([0x39, 0x01, 0x00]))).toBe(-257);
    });

    test("decodes -65537 (4-byte)", () => {
      // -65537 = -1 - 65536
      expect(decodeCbor(new Uint8Array([0x3a, 0x00, 0x01, 0x00, 0x00]))).toBe(-65537);
    });
  });

  describe("byte strings (major type 2)", () => {
    test("decodes empty byte string", () => {
      const result = decodeCbor(new Uint8Array([0x40]));
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(new Uint8Array([]));
    });

    test("decodes byte string with content", () => {
      const result = decodeCbor(new Uint8Array([0x44, 0x01, 0x02, 0x03, 0x04]));
      expect(result).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    });

    test("decodes byte string returns a copy (not a view)", () => {
      const input = new Uint8Array([0x42, 0xaa, 0xbb]);
      const result = decodeCbor(input) as Uint8Array;
      input[1] = 0xff;
      expect(result[0]).toBe(0xaa);
    });
  });

  describe("text strings (major type 3)", () => {
    test("decodes empty text string", () => {
      expect(decodeCbor(new Uint8Array([0x60]))).toBe("");
    });

    test("decodes ASCII text", () => {
      // "fmt" = 0x66, 0x6d, 0x74
      expect(decodeCbor(new Uint8Array([0x63, 0x66, 0x6d, 0x74]))).toBe("fmt");
    });

    test("decodes longer text string", () => {
      // "none" = 0x6e, 0x6f, 0x6e, 0x65
      expect(decodeCbor(new Uint8Array([0x64, 0x6e, 0x6f, 0x6e, 0x65]))).toBe("none");
    });

    test("decodes text with multibyte UTF-8", () => {
      // "ü" = 0xc3 0xbc (2 bytes in UTF-8)
      expect(decodeCbor(new Uint8Array([0x62, 0xc3, 0xbc]))).toBe("ü");
    });
  });

  describe("arrays (major type 4)", () => {
    test("decodes empty array", () => {
      expect(decodeCbor(new Uint8Array([0x80]))).toEqual([]);
    });

    test("decodes array of integers", () => {
      // [1, 2, 3]
      expect(decodeCbor(new Uint8Array([0x83, 0x01, 0x02, 0x03]))).toEqual([1, 2, 3]);
    });

    test("decodes array of text strings (credential transports)", () => {
      // ["internal", "hybrid"]
      const encoder = new TextEncoder();
      const internal = encoder.encode("internal");
      const hybrid = encoder.encode("hybrid");
      const cbor = new Uint8Array([
        0x82, // array(2)
        0x68, // text(8)
        ...internal,
        0x66, // text(6)
        ...hybrid,
      ]);
      expect(decodeCbor(cbor)).toEqual(["internal", "hybrid"]);
    });

    test("decodes nested arrays", () => {
      // [[1], [2, 3]]
      const cbor = new Uint8Array([
        0x82, // array(2)
        0x81,
        0x01, // array(1): [1]
        0x82,
        0x02,
        0x03, // array(2): [2, 3]
      ]);
      expect(decodeCbor(cbor)).toEqual([[1], [2, 3]]);
    });
  });

  describe("maps (major type 5)", () => {
    test("decodes empty map", () => {
      const result = decodeCbor(new Uint8Array([0xa0])) as Map<number | string, unknown>;
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test("decodes map with text keys (attestationObject top-level)", () => {
      // {"fmt": "none"}
      const cbor = new Uint8Array([
        0xa1, // map(1)
        0x63,
        0x66,
        0x6d,
        0x74, // text(3) "fmt"
        0x64,
        0x6e,
        0x6f,
        0x6e,
        0x65, // text(4) "none"
      ]);
      const result = decodeCbor(cbor) as Map<string, unknown>;
      expect(result.get("fmt")).toBe("none");
    });

    test("decodes map with integer keys (COSE key structure)", () => {
      // {1: 2, 3: -7, -1: 1}
      // COSE EC2 key: kty=2, alg=-7, crv=P-256(1)
      const cbor = new Uint8Array([
        0xa3, // map(3)
        0x01,
        0x02, // 1: 2 (kty: EC2)
        0x03,
        0x26, // 3: -7 (alg: ES256)
        0x20,
        0x01, // -1: 1 (crv: P-256)
      ]);
      const result = decodeCbor(cbor) as Map<number, unknown>;
      expect(result.get(1)).toBe(2);
      expect(result.get(3)).toBe(-7);
      expect(result.get(-1)).toBe(1);
    });

    test("decodes map with mixed key types", () => {
      // {1: 2, "alg": -7}
      const cbor = new Uint8Array([
        0xa2, // map(2)
        0x01,
        0x02, // 1: 2
        0x63,
        0x61,
        0x6c,
        0x67, // text(3) "alg"
        0x26, // -7
      ]);
      const result = decodeCbor(cbor) as Map<number | string, unknown>;
      expect(result.get(1)).toBe(2);
      expect(result.get("alg")).toBe(-7);
    });
  });

  describe("simple values (major type 7)", () => {
    test("decodes false", () => {
      expect(decodeCbor(new Uint8Array([0xf4]))).toBe(false);
    });

    test("decodes true", () => {
      expect(decodeCbor(new Uint8Array([0xf5]))).toBe(true);
    });

    test("decodes null", () => {
      expect(decodeCbor(new Uint8Array([0xf6]))).toBeNull();
    });
  });

  describe("nested structures (WebAuthn-like)", () => {
    test("decodes COSE key with byte string coordinates", () => {
      // Simplified COSE EC2 key: {1: 2, 3: -7, -1: 1, -2: <x>, -3: <y>}
      const xCoord = new Uint8Array(32).fill(0xaa);
      const yCoord = new Uint8Array(32).fill(0xbb);
      const cbor = new Uint8Array([
        0xa5, // map(5)
        0x01,
        0x02, // 1: 2 (kty: EC2)
        0x03,
        0x26, // 3: -7 (alg: ES256)
        0x20,
        0x01, // -1: 1 (crv: P-256)
        0x21,
        0x58,
        0x20,
        ...xCoord, // -2: bytes(32) x-coordinate
        0x22,
        0x58,
        0x20,
        ...yCoord, // -3: bytes(32) y-coordinate
      ]);
      const result = decodeCbor(cbor) as Map<number, unknown>;
      expect(result.get(1)).toBe(2);
      expect(result.get(3)).toBe(-7);
      expect(result.get(-1)).toBe(1);
      expect(result.get(-2)).toEqual(xCoord);
      expect(result.get(-3)).toEqual(yCoord);
    });

    test("decodes attestationObject-like structure", () => {
      // { "fmt": "none", "attStmt": {}, "authData": <bytes> }
      const authData = new Uint8Array(37).fill(0xcc);
      const cbor = new Uint8Array([
        0xa3, // map(3)
        0x63,
        0x66,
        0x6d,
        0x74, // text(3) "fmt"
        0x64,
        0x6e,
        0x6f,
        0x6e,
        0x65, // text(4) "none"
        0x67,
        0x61,
        0x74,
        0x74,
        0x53,
        0x74,
        0x6d,
        0x74, // text(7) "attStmt"
        0xa0, // map(0) — empty attestation statement
        0x68,
        0x61,
        0x75,
        0x74,
        0x68,
        0x44,
        0x61,
        0x74,
        0x61, // text(8) "authData"
        0x58,
        0x25,
        ...authData, // bytes(37)
      ]);
      const result = decodeCbor(cbor) as Map<string, unknown>;
      expect(result.get("fmt")).toBe("none");
      const attStmt = result.get("attStmt") as Map<string, unknown>;
      expect(attStmt).toBeInstanceOf(Map);
      expect(attStmt.size).toBe(0);
      expect(result.get("authData")).toEqual(authData);
    });

    test("decodes map containing an array of text strings", () => {
      // { "transports": ["internal", "hybrid"] }
      const encoder = new TextEncoder();
      const internal = encoder.encode("internal");
      const hybrid = encoder.encode("hybrid");
      const transports = encoder.encode("transports");
      const cbor = new Uint8Array([
        0xa1, // map(1)
        0x6a,
        ...transports, // text(10) "transports"
        0x82, // array(2)
        0x68,
        ...internal, // text(8) "internal"
        0x66,
        ...hybrid, // text(6) "hybrid"
      ]);
      const result = decodeCbor(cbor) as Map<string, unknown>;
      expect(result.get("transports")).toEqual(["internal", "hybrid"]);
    });

    test("decodes map with booleans and null", () => {
      // { "backedUp": true, "uvInitialized": false, "extra": null }
      const encoder = new TextEncoder();
      const cbor = new Uint8Array([
        0xa3, // map(3)
        0x68,
        ...encoder.encode("backedUp"), // text(8) "backedUp"
        0xf5, // true
        0x6d,
        ...encoder.encode("uvInitialized"), // text(13) "uvInitialized"
        0xf4, // false
        0x65,
        ...encoder.encode("extra"), // text(5) "extra"
        0xf6, // null
      ]);
      const result = decodeCbor(cbor) as Map<string, unknown>;
      expect(result.get("backedUp")).toBe(true);
      expect(result.get("uvInitialized")).toBe(false);
      expect(result.get("extra")).toBeNull();
    });
  });

  describe("real WebAuthn attestation payload", () => {
    test("decodes a minimal packed attestation object", () => {
      // Real-world-like attestation object structure:
      // { "fmt": "packed", "attStmt": { "alg": -7, "sig": <bytes> }, "authData": <bytes> }
      const sig = new Uint8Array(64).fill(0xde);
      const authData = new Uint8Array(77).fill(0xab);
      const cbor = new Uint8Array([
        0xa3, // map(3)
        0x63,
        0x66,
        0x6d,
        0x74, // text(3) "fmt"
        0x66,
        0x70,
        0x61,
        0x63,
        0x6b,
        0x65,
        0x64, // text(6) "packed"
        0x67,
        0x61,
        0x74,
        0x74,
        0x53,
        0x74,
        0x6d,
        0x74, // text(7) "attStmt"
        0xa2, // map(2)
        0x63,
        0x61,
        0x6c,
        0x67, // text(3) "alg"
        0x26, // -7
        0x63,
        0x73,
        0x69,
        0x67, // text(3) "sig"
        0x58,
        0x40,
        ...sig, // bytes(64)
        0x68,
        0x61,
        0x75,
        0x74,
        0x68,
        0x44,
        0x61,
        0x74,
        0x61, // text(8) "authData"
        0x58,
        0x4d,
        ...authData, // bytes(77)
      ]);
      const result = decodeCbor(cbor) as Map<string, unknown>;
      expect(result.get("fmt")).toBe("packed");
      const attStmt = result.get("attStmt") as Map<string, unknown>;
      expect(attStmt.get("alg")).toBe(-7);
      expect(attStmt.get("sig")).toEqual(sig);
      expect(result.get("authData")).toEqual(authData);
    });
  });

  describe("error cases", () => {
    test("throws on empty input", () => {
      expect(() => decodeCbor(new Uint8Array([]))).toThrow("CBOR: empty input");
    });

    test("throws on truncated 2-byte integer", () => {
      // 0x19 expects 2 bytes to follow
      expect(() => decodeCbor(new Uint8Array([0x19, 0x01]))).toThrow(
        "CBOR: unexpected end of input reading 2-byte argument",
      );
    });

    test("throws on truncated byte string", () => {
      // byte string claiming length 4 but only 2 bytes follow
      expect(() => decodeCbor(new Uint8Array([0x44, 0x01, 0x02]))).toThrow(
        "CBOR: byte string length exceeds available data",
      );
    });

    test("throws on truncated text string", () => {
      // text string claiming length 3 but only 1 byte follows
      expect(() => decodeCbor(new Uint8Array([0x63, 0x61]))).toThrow(
        "CBOR: text string length exceeds available data",
      );
    });

    test("throws on unsupported major type 6 (tags)", () => {
      // Tag with value 0
      expect(() => decodeCbor(new Uint8Array([0xc0, 0x00]))).toThrow(
        "CBOR: unsupported major type 6",
      );
    });

    test("throws on unsupported simple value (undefined = 0xf7)", () => {
      expect(() => decodeCbor(new Uint8Array([0xf7]))).toThrow("CBOR: unsupported simple value 23");
    });

    test("throws on truncated map value", () => {
      // map(1) with key but no value
      expect(() => decodeCbor(new Uint8Array([0xa1, 0x01]))).toThrow(
        "CBOR: unexpected end of input",
      );
    });

    test("throws on truncated array item", () => {
      // array(2) with only 1 item
      expect(() => decodeCbor(new Uint8Array([0x82, 0x01]))).toThrow(
        "CBOR: unexpected end of input",
      );
    });
  });
});
