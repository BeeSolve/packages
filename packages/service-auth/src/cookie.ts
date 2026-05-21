export function addSetCookies(props: {
  headers: Headers;
  cookies: {
    sid: string;
    maxAge: number;
  }[];
}): Headers {
  for (const { sid, maxAge } of props.cookies) {
    [
      `__Host-SID=${sid}; HttpOnly; Max-Age=${maxAge}; SameSite=Strict; Secure; Path=/`,
      `aSID=${maxAge > 0 ? 1 : 0}; Max-Age=${maxAge}; SameSite=Strict; Secure; Path=/`,
    ].forEach((value) => props.headers.append("Set-Cookie", value));
  }

  return props.headers;
}

export function parseSid(cookieHeader: string | null | undefined) {
  if (cookieHeader == null) return null;

  // Splits on "=" and takes index [1] only — safe because SID tokens are
  // base64url-encoded (no "=" padding). If the token format ever changes
  // to include "=", replace with an indexOf("=")-based split.
  return (
    cookieHeader
      .split(";")
      .map((item) => item.split("="))
      .filter(([key]) => key?.trim() === "__Host-SID")?.[0]?.[1] ?? null
  );
}

const cookieName = "__Host-DataToken";
export function toDataTokenCookie(token: string, maxAge: number = 900) {
  return `${cookieName}=${token}; HttpOnly; Max-Age=${maxAge}; SameSite=Lax; Secure; Path=/`;
}

export function parseDataTokenCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (cookieHeader == null) return null;

  // Same index [1] assumption as parseSid — safe while tokens are base64url.
  return (
    cookieHeader
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key]) => key?.trim() === cookieName)?.[0]?.[1] ?? null
  );
}
