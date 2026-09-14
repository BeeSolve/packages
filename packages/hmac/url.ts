import type { HmacSigner } from ".";

const expiresAtParam = "expiresAt";
const signatureParam = "signature";

/**
 * Signs a URL, appending an `expiresAt` timestamp and a `signature` query
 * parameter. Query parameters are sorted before signing so the signature is
 * stable regardless of their original order. The signed URL can later be
 * checked with {@link ensureValidUrl}.
 */
export function signUrl(props: {
  url: URL;
  expiresInSeconds: number;
  hmac: Pick<HmacSigner, "sign">;
}): string {
  const url = new URL(props.url);
  const expiresAt = Math.floor(Date.now() / 1000) + props.expiresInSeconds;

  url.searchParams.set(expiresAtParam, String(expiresAt));
  url.searchParams.delete(signatureParam);
  sortSearchParams(url);

  const signature = props.hmac.sign(url.toString());
  url.searchParams.set(signatureParam, signature);

  return url.toString();
}

/**
 * Verifies a URL produced by {@link signUrl}.
 *
 * Returns nothing on success and throws a {@link SignedUrlError} with a
 * {@link SignedUrlErrorCode} describing why verification failed.
 */
export function ensureValidUrl(props: {
  url: URL;
  hmac: Pick<HmacSigner, "isValidSignature">;
}): void {
  const signature = props.url.searchParams.get(signatureParam);
  if (signature == null) {
    throw new SignedUrlError({
      code: "MISSING_SIGNATURE",
      message: `URL is missing the "${signatureParam}" query parameter.`,
    });
  }

  const expiresAt = props.url.searchParams.get(expiresAtParam);
  if (expiresAt == null) {
    throw new SignedUrlError({
      code: "MISSING_EXPIRES_AT",
      message: `URL is missing the "${expiresAtParam}" query parameter.`,
    });
  }

  const expiresAtSeconds = Number(expiresAt);
  if (!Number.isFinite(expiresAtSeconds)) {
    throw new SignedUrlError({
      code: "MALFORMED_EXPIRES_AT",
      message: `URL "${expiresAtParam}" query parameter is not a valid number.`,
    });
  }

  if (Math.floor(Date.now() / 1000) >= expiresAtSeconds) {
    throw new SignedUrlError({ code: "EXPIRED", message: "URL has expired." });
  }

  const url = new URL(props.url);
  url.searchParams.delete(signatureParam);
  sortSearchParams(url);

  if (!props.hmac.isValidSignature({ value: url.toString(), signature })) {
    throw new SignedUrlError({
      code: "INVALID_SIGNATURE",
      message: "URL signature does not match.",
    });
  }
}

function sortSearchParams(url: URL): void {
  const entries = [...url.searchParams.entries()].sort(([leftKey], [rightKey]) =>
    leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
  );

  url.search = "";

  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
}

export const signedUrlErrorCodes = [
  "MISSING_SIGNATURE",
  "MISSING_EXPIRES_AT",
  "MALFORMED_EXPIRES_AT",
  "EXPIRED",
  "INVALID_SIGNATURE",
] as const;

export type SignedUrlErrorCode = (typeof signedUrlErrorCodes)[number];

export class SignedUrlError extends Error {
  readonly code: SignedUrlErrorCode;

  constructor(props: { code: SignedUrlErrorCode; message: string }) {
    super(props.message);
    this.name = "SignedUrlError";
    this.code = props.code;
  }
}
