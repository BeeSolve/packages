// oxlint-disable typescript/no-non-null-assertion
/**
 * Produces the UUID version 7.
 *
 * Optionally, you can provide the timestamp in milliseconds.
 *
 * Returned value is:
 *  - base36 encoded
 *  - includes UNIX timestamp (with milliseconds) in the first 6 bytes
 *  - sortable by creation date in both encoded or decoded form
 *  - suitable for case-insensitive systems (MySQL, etc.)
 *  - 24 characters long until year 2558, then 25 characters long
 */
export function uuid7(timestamp: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  bytes[0] = timestamp / 2 ** 40;
  bytes[1] = timestamp / 2 ** 32;
  bytes[2] = timestamp / 2 ** 24;
  bytes[3] = timestamp / 2 ** 16;
  bytes[4] = timestamp / 2 ** 8;
  bytes[5] = timestamp;

  // Version and variant.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return base36Encode(bytes);
}

/**
 * Decodes the UUIDv7 and returns the Date it was created.
 *
 * Throws an error if the UUID is invalid.
 */
export function uuid7ToDate(value: string): Date {
  const decoded = base36Decode(value);

  const timestamp =
    decoded[0]! * 2 ** 40 +
    decoded[1]! * 2 ** 32 +
    decoded[2]! * 2 ** 24 +
    decoded[3]! * 2 ** 16 +
    decoded[4]! * 2 ** 8 +
    decoded[5]!;

  // Verify version and variant.
  if ((decoded[6]! & 0xf0) !== 0x70 || (decoded[8]! & 0xc0) !== 0x80) {
    throw new Error(`Unable to extract Date from "${value}"! UUID version 7 is expected.`);
  }

  return new Date(timestamp);
}

/**
 * Encodes the given data to base36.
 *
 * Alphabet is an extension of HEX encoding.
 */
export function base36Encode(data: Uint8Array): string {
  let hex = "0x";

  data.forEach((i) => {
    let h = i.toString(16);
    if (h.length % 2) {
      h = "0" + h;
    }
    hex += h;
  });

  return BigInt(hex).toString(36);
}

/**
 * Decodes the base36 string to the Uint8Array.
 *
 * Alphabet is an extension of HEX encoding.
 */
export function base36Decode(str: string): Uint8Array {
  const bigint = [...str].reduce((acc, curr) => BigInt(parseInt(curr, 36)) + BigInt(36) * acc, 0n);

  let hex = bigint.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  }

  const len = hex.length / 2;
  const u8 = new Uint8Array(len);

  let i = 0;
  let j = 0;
  while (i < len) {
    u8[i] = parseInt(hex.slice(j, j + 2), 16);
    i += 1;
    j += 2;
  }

  return u8;
}
