export const supportedQueryKeys = [
  "dpr",
  "fit",
  "flip",
  "fm",
  "h",
  "placeholder",
  "q",
  "rot",
  "w",
] as const;
export type SupportedQueryKey = (typeof supportedQueryKeys)[number];

export const fitModes = ["clip", "max", "scale"] as const;
export type FitMode = (typeof fitModes)[number];

export const outputFormats = ["webp", "jpg", "png"] as const;
export type OutputFormat = (typeof outputFormats)[number];

export const flipModes = ["h", "v", "hv"] as const;
export type FlipMode = (typeof flipModes)[number];

export const rotations = [0, 90, 180, 270] as const;
export type Rotation = (typeof rotations)[number];

export function isRotation(value: number): value is Rotation {
  return rotations.some((rotation) => rotation === value);
}

export const queryDefaults = {
  dpr: 1,
  fit: "clip",
  q: 75,
  rot: 0,
  placeholder: "0",
} as const;

export type CanonicalQueryResult = { query: string } | { error: string };

const unsupportedQueryKeys = ["crop", "blur"];
const unsupportedFitModes = ["crop", "min", "fill", "fillmax", "clamp", "facearea"];

/**
 * Normalizes a raw query string into the canonical form used as the CloudFront cache key.
 * Keeps only supported keys, lowercases keys, keeps the last value of duplicated keys, drops
 * empty values and values equal to their default, normalizes numbers and sorts by key.
 * Returns an error for known imgix parameters that are not supported and for invalid values.
 */
export function canonicalizeQuery(query: string): CanonicalQueryResult {
  const parsed = parseQuery(query);
  if ("error" in parsed) return parsed;

  const normalized: Record<string, string> = {};
  for (let index = 0; index < supportedQueryKeys.length; index++) {
    const key = supportedQueryKeys[index];
    if (key == null) continue;
    const value = parsed.values[key];
    if (value == null || value === "") continue;
    const result = normalizeValue({ key, value });
    if ("error" in result) return result;
    if (result.value != null) normalized[key] = result.value;
  }

  const pairs = Object.keys(normalized)
    .sort()
    .map((key) => `${key}=${normalized[key]}`);
  return { query: pairs.join("&") };
}

function parseQuery(query: string): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  const raw = query.charAt(0) === "?" ? query.slice(1) : query;
  if (raw === "") return { values };

  const parts = raw.split("&");
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part == null || part === "") continue;
    const separator = part.indexOf("=");
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    const rawValue = separator === -1 ? "" : part.slice(separator + 1);
    const key = safeDecode(rawKey);
    const value = safeDecode(rawValue);
    if (key == null || value == null) return { error: "Invalid percent-encoding in query string" };
    const lowerKey = key.toLowerCase();
    if (unsupportedQueryKeys.indexOf(lowerKey) !== -1) {
      return { error: `Parameter "${lowerKey}" is not supported` };
    }
    values[lowerKey] = value;
  }
  return { values };
}

interface NormalizeProps {
  key: SupportedQueryKey;
  value: string;
}

type NormalizeResult = { value: string | undefined } | { error: string };

function normalizeValue(props: NormalizeProps): NormalizeResult {
  const key = props.key;
  const value = props.value.trim().toLowerCase();

  if (key === "fit") return normalizeFit(value);
  if (key === "fm") return normalizeEnum({ key, value, allowed: outputFormats });
  if (key === "flip") return normalizeEnum({ key, value, allowed: flipModes });
  if (key === "placeholder") return normalizePlaceholder(value);
  if (key === "rot") return normalizeRotation(value);
  if (key === "dpr") {
    return normalizeNumber({ key, value, integer: false, defaultValue: queryDefaults.dpr });
  }
  if (key === "q") {
    return normalizeNumber({ key, value, integer: true, defaultValue: queryDefaults.q });
  }
  if (key === "w" || key === "h") {
    return normalizeNumber({ key, value, integer: true, defaultValue: undefined });
  }
  return assertUnreachable(key);
}

function normalizeFit(value: string): NormalizeResult {
  if (unsupportedFitModes.indexOf(value) !== -1) {
    return { error: `Parameter "fit=${value}" is not supported` };
  }
  const result = normalizeEnum({ key: "fit", value, allowed: fitModes });
  if ("error" in result) return result;
  return { value: result.value === queryDefaults.fit ? undefined : result.value };
}

interface EnumProps {
  key: string;
  value: string;
  allowed: ReadonlyArray<string>;
}

function normalizeEnum(props: EnumProps): NormalizeResult {
  if (props.allowed.indexOf(props.value) === -1) {
    return {
      error: `Parameter "${props.key}" must be one of ${props.allowed.join(", ")}`,
    };
  }
  return { value: props.value };
}

function normalizePlaceholder(value: string): NormalizeResult {
  if (value === "0") return { value: undefined };
  if (value === "1") return { value };
  return { error: 'Parameter "placeholder" must be 0 or 1' };
}

function normalizeRotation(value: string): NormalizeResult {
  const result = normalizeNumber({
    key: "rot",
    value,
    integer: true,
    defaultValue: queryDefaults.rot,
  });
  if ("error" in result) return result;
  if (result.value == null) return result;
  if (!isRotation(Number(result.value))) {
    return { error: `Parameter "rot" must be one of ${rotations.join(", ")}` };
  }
  return result;
}

interface NumberProps {
  key: SupportedQueryKey;
  value: string;
  integer: boolean;
  defaultValue: number | undefined;
}

function normalizeNumber(props: NumberProps): NormalizeResult {
  const key = props.key;
  const value = props.value;
  if (!/^\d{1,9}(\.\d{1,9})?$/.test(value)) {
    return { error: `Parameter "${key}" must be a number` };
  }
  const parsed = Number(value);
  if (props.integer && !Number.isInteger(parsed)) {
    return { error: `Parameter "${key}" must be an integer` };
  }
  if (parsed === props.defaultValue) return { value: undefined };
  return { value: String(parsed) };
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
