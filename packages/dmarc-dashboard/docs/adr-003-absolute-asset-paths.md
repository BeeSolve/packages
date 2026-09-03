# ADR-003: Use Absolute Asset Paths Under kit-on-lambda

## Status

Accepted

## Context

The dashboard is a SvelteKit app deployed via the `kit-on-lambda` adapter behind
CloudFront. SvelteKit can emit asset references (the `/_app/*` immutable bundles and
CSS) either as **relative** paths (`./_app/...`) or **absolute** paths (`/_app/...`),
controlled by the `kit.paths.relative` option. As of SvelteKit 2 the default is
`relative: true`.

Relative asset paths are resolved by the browser against the URL of the current
document. That works when the served HTML lives at a fixed, known depth. But
`kit-on-lambda` serves routes **dynamically** through the SSR Lambda — the same app
shell is rendered for `/`, `/domains`, `/domains/example.com`, and deeper nested
routes. With relative paths, the browser resolves `./_app/immutable/...` against the
current route's depth:

- At `/` → resolves to `/_app/immutable/...` (correct)
- At `/domains/example.com` → resolves to `/domains/example.com/_app/immutable/...`
  (wrong — that path is served by the SSR Lambda, not the S3 asset origin, so it 404s
  or returns HTML)

The visible effect was that nested routes loaded with missing styling and failed
module imports, because the asset URLs pointed at the wrong location. The bug did not
reproduce at the root route, only on deeper paths.

## Decision

Set `kit.paths.relative = false` in `svelte.config.js` so SvelteKit emits **absolute**
asset paths (`/_app/...`). Absolute paths always resolve to the same location
regardless of the depth of the route the HTML was served for, so the `/_app/*`
CloudFront behavior (S3 asset origin) is hit correctly on every route.

```js
kit: {
  adapter: adapter({ out: "dist/build" }),
  paths: { relative: false },
}
```

## Rationale

### 1. Asset location is fixed, route depth is not

The immutable assets live at a single, stable prefix (`/_app/*`) served by a dedicated
CloudFront behavior. Absolute paths encode that fixed location directly. Relative paths
re-derive it from the document URL, which is variable because the SSR Lambda renders the
same shell at arbitrary depths — a mismatch that only manifests on nested routes.

### 2. Matches how kit-on-lambda routes requests

CloudFront routes `/_app/*` to the S3 asset origin and everything else to the SSR
Lambda. An absolute `/_app/...` request lands on the asset behavior by construction. A
depth-relative path like `/domains/x/_app/...` does not match the `/_app/*` behavior, so
it falls through to the SSR Lambda — which cannot serve the bundle.

### 3. The failure mode is silent and depth-dependent

Relative paths work at the root and break only deeper in the app, so the problem is easy
to miss in casual testing and expensive to diagnose later. Pinning absolute paths removes
the entire class of bug rather than papering over specific routes.

## Consequences

- The app assumes it is served from the domain root (assets at `/_app/*`). It is not
  portable to a sub-path deployment (e.g. `https://host/dashboard/`) without also
  configuring `kit.paths.base`. This is acceptable: the app is deployed at the root of
  its own CloudFront distribution.
- Anyone reverting to the SvelteKit default (`relative: true`) will reintroduce the
  nested-route styling failure. The inline comment in `svelte.config.js` and this ADR
  record why the non-default value is required.
- This is one of several deployment-config constraints specific to running SvelteKit
  behind CloudFront via kit-on-lambda; the app has a documented history of
  asset-routing sensitivity in this environment.

## Alternatives Considered

### Keep the SvelteKit default (`relative: true`)

Rejected — this is the configuration that produced the bug. Relative paths only resolve
correctly when the document is served at a fixed depth, which is not the case when the
SSR Lambda renders the same shell across nested routes.

### Set `kit.paths.base` to pin a prefix

`paths.base` addresses serving the app under a sub-path, not the relative-vs-absolute
resolution problem. It would add configuration without fixing the depth-dependent
resolution, and the app is served at the root anyway. Absolute paths are the direct fix.

### Rewrite asset URLs at the edge (CloudFront Function)

A viewer/origin function could normalize depth-prefixed asset requests back to `/_app/*`.
Rejected as unnecessary complexity and runtime cost to work around a problem a build-time
config flag solves cleanly.

## References

- Introduced in commit `aa280e0` — "fix(dmarc-dashboard): use absolute asset paths for
  nested routes".
- Related asset-serving investigation: `docs/bugs/002-cloudfront-module-import-failed.md`.
- SvelteKit `paths.relative`: https://svelte.dev/docs/kit/configuration#paths
- `svelte.config.js` in this package — the setting and an inline explanation.
