const tokens = {
  null: "_n",
  undefined: "_u",
  positiveInfinity: "_pi",
  negativeInfinity: "_ni",
  nan: "_nan",
  string: "s",
  number: "n",
  boolean: "b",
  date: "d",
  bigInt: "B",
  buffer: "p",
  formData: "f",
} as const;

const maxDepth = 30;

// oxlint-disable-next-line typescript/no-explicit-any
export function encodeToStringifiable(value: any) {
  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    encodedValue: encodeValue(value) as any,
    ___encoded: "v1",
  };
}

// oxlint-disable-next-line typescript/no-explicit-any
export function decodeFromStringifiable<T = any>(value: any): T {
  if (!isPlainObject(value)) {
    throw Error(`Only plain objects can be decoded.`);
  }

  const { ___encoded, encodedValue } = value;
  if (___encoded === "v1") {
    return decodeValue(encodedValue);
  }

  throw Error(`Unsupported version: "${{ ___encoded }}"`);
}

// oxlint-disable-next-line typescript/no-explicit-any
function decodeValue(value: any): any {
  if (typeof value === "string") {
    if (value.startsWith("_")) {
      if (value === tokens.null) return null;
      if (value === tokens.undefined) return undefined;
      if (value === tokens.positiveInfinity) return +Infinity;
      if (value === tokens.negativeInfinity) return -Infinity;
      if (value === tokens.nan) return Number.NaN;

      throw Error(`Unsupported token "${value}"`);
    }

    const token = value.charAt(0);
    const val = value.slice(1);

    if (token === tokens.string) return val;
    if (token === tokens.number) return Number(val);
    if (token === tokens.boolean) return val === "true";
    if (token === tokens.date) return new Date(val);
    if (token === tokens.bigInt) return BigInt(val);
    if (token === tokens.buffer) return Buffer.from(val, "base64url");
    if (token === tokens.formData) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(JSON.parse(val))) {
        // oxlint-disable-next-line typescript/no-explicit-any
        formData.append(key, value as any);
      }
      return formData;
    }

    throw Error(`Unsupported token "${token}" for value "${value}"`);
  }

  if (Array.isArray(value)) return value.map((item) => decodeValue(item));
  if (typeof value === "object")
    return Object.entries(value).reduce(
      (result, [k, v]) => {
        result[k] = decodeValue(v);
        return result;
      },
      // oxlint-disable-next-line typescript/no-explicit-any
      {} as Record<string, any>,
    );

  throw Error(`Unable to decode value. "${value}"`);
}

// oxlint-disable-next-line typescript/no-explicit-any beesolve/prefer-props-object
function encodeValue(value: any, depth = 0): any {
  if (depth > maxDepth) throw Error(`Cannot encode - max object depth (${maxDepth}) reached.`);

  if (typeof value === "function") throw Error(`Cannot encode function`);
  if (typeof value === "symbol") throw Error(`Cannot encode symbol`);

  if (value === null) return tokens.null;
  if (value === undefined) return tokens.undefined;
  if (typeof value === "boolean") return `${tokens.boolean}${value}`;
  if (typeof value === "string") return `${tokens.string}${value}`;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return `${tokens.number}${value}`;
    if (value > 0) return tokens.positiveInfinity;
    if (value < 0) return tokens.negativeInfinity;
  }
  if (Number.isNaN(value)) return tokens.nan;
  if (typeof value === "bigint") return `${tokens.bigInt}${value}`;
  if (value instanceof Date) return `${tokens.date}${value.toISOString()}`;

  if (globalThis.Buffer != null && Buffer.isBuffer(value))
    return `${tokens.buffer}${value.toString("base64url")}`;

  if (Array.isArray(value)) return value.map((value) => encodeValue(value, depth + 1));

  if (value instanceof FormData) {
    return `${tokens.formData}${JSON.stringify(Object.fromEntries(value.entries()))}`;
  }

  if (isPlainObject(value))
    return Object.entries(value).reduce(
      (result, [key, value]) => {
        result[key] = encodeValue(value, depth + 1);

        return result;
      },
      // oxlint-disable-next-line typescript/no-explicit-any
      {} as Record<string, any>,
    );

  throw Error(`Cannot encode - unsupported value ${typeof value}: "${value}"`);
}

// oxlint-disable-next-line typescript/no-explicit-any
function isPlainObject(value: any) {
  return typeof value === "object" && value !== null && value.constructor === Object;
}
