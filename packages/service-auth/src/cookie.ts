/**
 * Appends `Set-Cookie` headers for the session.
 *
 * Sets two cookies per session entry:
 * - `__Host-SID` — the actual session token. `HttpOnly` so JavaScript cannot read it.
 * - `aSID` — a JavaScript-readable companion cookie (`1` = active, `0` = cleared).
 *   SPAs use this to detect auth state client-side without exposing the session token.
 *   It is a UI hint only — actual session enforcement happens server-side.
 */
export function addSetCookies(props: {
  headers: Headers;
  cookies: Array<{
    sid: string;
    maxAge: number;
  }>;
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
// oxlint-disable-next-line beesolve/prefer-props-object
export function toDataTokenCookie(token: string, maxAge: number = 900) {
  return `${cookieName}=${token}; HttpOnly; Max-Age=${maxAge}; SameSite=Strict; Secure; Path=/`;
}

export function parseDataTokenCookie(cookieHeader: string | null | undefined): string | null {
  if (cookieHeader == null) return null;

  // Same index [1] assumption as parseSid — safe while tokens are base64url.
  return (
    cookieHeader
      .split(";")
      .map((item) => item.trim().split("="))
      .filter(([key]) => key?.trim() === cookieName)?.[0]?.[1] ?? null
  );
}
