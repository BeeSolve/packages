# ADR-005: Dual-Mode Request/Response Handling

## Status

Accepted

## Date

2026-07-23

## Context

The auth service endpoints (`/auth/signInComplete`, `/auth/signOut`) previously returned 301 redirects with a `Location` header. This worked for the initial assumption that these endpoints would always be called via native browser form submissions.

In practice, the primary consumer is a SPA that calls these endpoints via `fetch()`. The `fetch` API does not navigate the browser on receiving a redirect — the response is returned as a regular response object. With `redirect: "manual"`, the response becomes opaque (status 0, no readable body or headers). With `redirect: "follow"` (the default), `fetch` follows the redirect transparently but the browser does not visually navigate — defeating the purpose.

This means:

1. SPA callers cannot use the redirect response. They need a JSON body with the redirect URL so they can call `window.location.href` themselves.
2. Native `<form>` submissions (progressive enhancement, no-JS fallback) need the 303 redirect so the browser navigates automatically.

Additionally, form submissions send `application/x-www-form-urlencoded` bodies, while SPAs send `application/json`. The service previously rejected anything other than `application/json`.

## Decision

Implement dual-mode handling at two layers:

### Request parsing (Content-Type negotiation)

All endpoints accept both `application/json` and `application/x-www-form-urlencoded` request bodies. The `getBody()` utility in `src/request.ts` inspects the `Content-Type` header and parses accordingly:

- `application/json` → parsed via `request.json()`
- `application/x-www-form-urlencoded` → parsed via `URLSearchParams` from `request.text()`

The `api.ts` entry point calls `getBody(request)` once and passes the result as a `requestBody` thunk to each handler. Each handler then validates with its own Valibot schema via `parseBody()`, ensuring identical business logic regardless of content type.

### Response mode (Accept negotiation)

Endpoints that need to redirect (`signInComplete`, `signOut`) inspect the `Accept` header directly:

- `Accept: application/json` → returns **200** with `{ "redirectTo": "/..." }` body
- Any other Accept value (including `*/*` or absent) → returns **303 See Other** with `Location` header, no body

The check is inlined in each handler via `headers.get("accept")?.includes("application/json")`.

### Status code: 303 See Other (not 301)

303 is semantically correct for POST-Redirect-GET (PRG). It instructs the browser to follow the redirect with a GET request, preventing the "resubmit form?" dialog on back-navigation. 301 was incorrect — it implies the resource has permanently moved.

### Endpoints that always return JSON

`/auth/signInRequest` and `/auth/resendCode` always return JSON (200) regardless of Accept header, because their response contains data (token, reference code, timestamps) that the client needs to continue the flow. There is no redirect variant for these. However, they still accept both content types on input.

## Consequences

### Positive

- Progressive enhancement: auth forms work without JavaScript via native form submission + 303 redirect.
- SPAs get a clean JSON interface with explicit redirect URLs — no reliance on opaque redirect behavior.
- Single endpoint serves both modes — no need for separate `/auth/signInComplete` and `/auth/signInComplete.json` endpoints.
- Correct HTTP semantics (303 for PRG instead of 301).
- Input validation is unified — both content types go through the same Valibot schema.

### Negative

- Slightly more complex request parsing — two code paths in `getBody()`, though handlers remain unaware of content type.
- Frontend `fetch` callers must set `Accept: application/json` header to get the JSON response. Without it, they would receive a 303 which `fetch` follows by default (resulting in an unexpected response from the redirect target).
- `application/x-www-form-urlencoded` does not support nested objects — schemas must use flat string fields only (which is already the case for all auth endpoints).

## Frontend Usage

### SPA (fetch)

```typescript
const res = await fetch("/auth/signInComplete", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ code, token, redirectTo: "/" }),
  credentials: "include",
});

const { redirectTo } = await res.json();
window.location.href = redirectTo;
```

### Native form (no-JS fallback)

```html
<form method="POST" action="/auth/signInComplete">
  <input type="hidden" name="token" value="..." />
  <input type="hidden" name="redirectTo" value="%2Fdashboard" />
  <input name="code" inputmode="numeric" maxlength="6" />
  <button type="submit">Verify</button>
</form>
```

The browser submits `application/x-www-form-urlencoded`, receives 303, and navigates to the redirect target.
