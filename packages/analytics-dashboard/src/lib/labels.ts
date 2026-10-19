import type { Grain, Tier, WatchMode } from "@beesolve/analytics-processor";
import { parsePeriodKey } from "@beesolve/analytics-processor";

export type View = Grain | "year";

/**
 * Short selector label for a traffic tier. `all` is every logged request;
 * `real` is genuine HTML page views; `watch` is the curated sitemap page set.
 */
export function tierLabel(tier: Tier): string {
  if (tier === "all") return "All";
  if (tier === "real") return "Real";
  return "Sitemap";
}

/**
 * One-line explanation of what a tier counts, shown under the controls.
 */
export function tierDescription(tier: Tier): string {
  if (tier === "all") {
    return "All traffic: every logged request, including bots, assets, and errors.";
  }
  if (tier === "real") {
    return "Real traffic: successful HTML page views (2xx text/html) - genuine page reads.";
  }
  return "Sitemap traffic: requests to the pages declared in your sitemap.";
}

/**
 * Human-readable label for a stored period key, converted from the UTC bucket
 * to the viewer's local timezone. An hour key `YYYY-MM-DD-HH` is shown as the
 * local clock range it spans (convention A: `-14` is the 14:00 hour, so it
 * reads "14:00 – 15:00"); a day/month/year reads as a calendar label.
 */
export function formatPeriodLabel({
  view,
  periodKey,
}: {
  readonly view: View;
  readonly periodKey: string;
}): string {
  const start = parsePeriodKey(periodKey);

  if (view === "hour") {
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      start,
    );
    return `${day}, ${formatClock(start)} – ${formatClock(end)}`;
  }

  if (view === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(start);
  }

  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(start);
  }

  return new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(start);
}

/** Compact label for dense axes (bar chart ticks). */
export function formatPeriodTick({
  view,
  periodKey,
}: {
  readonly view: View;
  readonly periodKey: string;
}): string {
  const start = parsePeriodKey(periodKey);

  if (view === "hour") return formatClock(start);
  if (view === "day")
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start);
  if (view === "month") return new Intl.DateTimeFormat(undefined, { month: "short" }).format(start);
  return new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(start);
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

const statusCodeExplanations: Record<string, string> = {
  "0": "No HTTP response was recorded — usually the viewer disconnected before CloudFront could respond (cancelled or timed-out request).",
  "200": "OK — the request succeeded and the full resource was returned.",
  "204": "No Content — the request succeeded but there is no response body.",
  "206":
    "Partial Content — only the requested byte range was returned (range request, e.g. media streaming or resumable downloads).",
  "301":
    "Moved Permanently — the resource has a new permanent URL; clients should update their links.",
  "302": "Found — a temporary redirect to another URL.",
  "303": "See Other — redirect to another URL using a GET request.",
  "304": "Not Modified — the client's cached copy is still valid; no body was sent.",
  "307": "Temporary Redirect — like 302 but the request method is preserved.",
  "308": "Permanent Redirect — like 301 but the request method is preserved.",
  "400": "Bad Request — the server could not understand the request.",
  "401": "Unauthorized — authentication is required or has failed.",
  "403": "Forbidden — the server understood the request but refuses to authorize it.",
  "404": "Not Found — the requested resource does not exist.",
  "405": "Method Not Allowed — the HTTP method is not supported for this resource.",
  "429":
    "Too Many Requests — the client has sent too many requests in a given time (rate limited).",
  "500": "Internal Server Error — the origin hit an unexpected error.",
  "502": "Bad Gateway — CloudFront received an invalid response from the origin.",
  "503": "Service Unavailable — the origin is temporarily overloaded or down.",
  "504": "Gateway Timeout — the origin did not respond to CloudFront in time.",
};

/**
 * Human-readable explanation for a CloudFront `sc-status` value. Status values
 * are stored as strings and may include the pseudo-status `"0"`, which
 * CloudFront logs when no HTTP response was recorded (viewer disconnect).
 * Falls back to a generic explanation by status class (2xx/3xx/4xx/5xx) for
 * any code not in the map, and to `undefined` when nothing sensible applies.
 */
export function statusCodeExplanation(value: string): string | undefined {
  const known = statusCodeExplanations[value];
  if (known != null) return known;

  if (/^[1-5]\d\d$/.test(value)) {
    const statusClass = value[0];
    if (statusClass === "1") return "Informational response.";
    if (statusClass === "2") return "Success — the request was received and accepted.";
    if (statusClass === "3")
      return "Redirection — further action is needed to complete the request.";
    if (statusClass === "4")
      return "Client error — the request was rejected as invalid or not allowed.";
    if (statusClass === "5") return "Server error — the origin failed to fulfil a valid request.";
  }

  return undefined;
}

const regionDisplayNames = new Intl.DisplayNames(undefined, { type: "region" });

/**
 * Convert a 2-letter ISO country code (CloudFront `cs-country`, e.g. `"US"`) to
 * a localized country name (e.g. "United States"). CloudFront emits `"-"` or an
 * empty value when the country is unknown; those and any code `Intl` cannot
 * resolve fall back to the raw value unchanged.
 */
export function formatCountry(value: string): string {
  if (!/^[A-Za-z]{2}$/.test(value)) return value;
  try {
    return regionDisplayNames.of(value.toUpperCase()) ?? value;
  } catch {
    return value;
  }
}

/**
 * Reconstruct the display pattern for a stored watch entry by re-appending the
 * mode's suffix (`*` for split, `+` for group, nothing for exact), the inverse
 * of the `parsePattern` sugar used when adding a watch entry.
 */
export function formatPattern({
  matcher,
  mode,
}: {
  readonly matcher: string;
  readonly mode: WatchMode;
}): string {
  if (mode === "split") return `${matcher}*`;
  if (mode === "group") return `${matcher}+`;
  return matcher;
}
