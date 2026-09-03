# BUG-002: Deployed app fails to load `/_app/immutable/*.js` — "Importing a module script failed"

## Status: Open (investigation not started)

## Date Discovered: 2026-09-03

## Package

`@beesolve/dmarc-dashboard` deployed via `kit-on-lambda` + CloudFront (not reproducible in `bun run dev`)

## Symptom

In the deployed CloudFront environment only:

- Console error: `Unhandled Promise Rejection: TypeError: Importing a module script failed`
- Console warnings for several assets, e.g.:
  - `/_app/immutable/nodes/0.*.js`
  - `/_app/immutable/nodes/5.*.js`
  - `/_app/immutable/chunks/*.js`
  - "...was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it wasn't preloaded for nothing."
- Visible effect: pages render with missing styling — the calendar collapses to a
  vertical list, summary cards are unstyled, tabs/tags look bare. This is a
  **symptom of the failed chunk load**, not a CSS/Svelte bug. It never reproduces
  under `bun run dev`; the app code and scoped styles are correct.

## Root Cause (diagnosed from code, UNCONFIRMED against live infra)

`kit-on-lambda` provisions asset serving as follows (see
`node_modules/kit-on-lambda/dist/cdk.js`):

- Static assets live under `/_app/*`. The adapter emits `build/routes.json`,
  which for this app is `["_app/*"]`.
- For each entry it adds a CloudFront behavior pointing at an **S3 static-website
  origin** (`bucket.bucketWebsiteDomainName`, `websiteIndexDocument: "index.html"`),
  cached with `CACHING_OPTIMIZED`.
- The default behavior (everything else) targets the SSR Lambda and carries the
  auth `ensureCookieFunction` (viewer-request). Static assets bypass auth.

`Importing a module script failed` is the browser refusing to execute a module
because the response body was **not JavaScript**. With an **S3 website origin**, a
missing object does not return a clean JSON 404 — the website endpoint returns an
**HTML** error/index document (often `200` or `404` with `Content-Type: text/html`).
The browser then tries to parse HTML as an ES module and throws. That some chunks
load and some fail points to a **hash/version mismatch** between the HTML the
Lambda serves and the immutable assets actually present in (or cached in front of)
the S3 bucket.

## Most likely causes (in order)

1. **Stale CloudFront cache after redeploy.** The SSR HTML references new immutable
   hashes, but the `/_app/*` behavior (or the bucket) still serves old hashes. New
   hashes 404 → HTML → module import fails. (`CACHING_OPTIMIZED` on `/_app/*` makes
   version skew during rollout likely.)
2. **Partial / failed `BucketDeployment`.** Not all current immutable files were
   uploaded, so specific chunks are absent.
3. **Content-Type mismatch** on S3 objects (`.js` served as
   `application/octet-stream`), which strict browsers reject for modules. Less
   likely (BucketDeployment sets types by extension) but cheap to rule out.

## Investigation plan (manual)

1. **Reproduce & capture.** Open the deployed site → DevTools → Network → hard
   reload. Find a failing `/_app/immutable/.../*.js` request. Record its **status
   code**, **Content-Type**, and the first bytes of the **response body** (JS vs
   `<!doctype html>`).
   - HTML body → S3-website fallback (points to cause 1 or 2).
   - JS body but wrong Content-Type → cause 3.
2. **Cross-check expected hashes.** `curl -sL <site>` (or view-source) and grep for
   `/_app/immutable/` references. Compare those filenames to what the browser
   requested and to what exists in S3.
3. **Inspect the bucket.** Find the assets bucket (stack `Assets` resource / the
   CloudFront S3-website origin), then:
   `aws s3 ls s3://<assets-bucket>/_app/immutable/ --recursive`
   Confirm the specific failing hashed files exist.
   - Missing → redeploy assets (re-run CDK deploy / `BucketDeployment`); verify the
     deploy step completed without truncation.
   - Present but stale vs the HTML → caching/version skew.
4. **Invalidate CloudFront.**
   `aws cloudfront create-invalidation --distribution-id <id> --paths '/_app/*' '/'`
   then retest. If it fixes it, the durable fix is ensuring deploys invalidate
   `/_app/*` (or shortening the asset cache during rollout).
5. **If Content-Type is wrong:** set correct types on upload (BucketDeployment
   `contentType`), or switch the origin from S3-website to an OAC/REST S3 origin
   (passes stored metadata, returns real 403/404 instead of HTML).

## Candidate fixes

- **Short term:** CloudFront invalidation of `/_app/*` after each deploy; confirm
  the `BucketDeployment` uploads the full current asset set.
- **Structural (higher effort, recommended if it recurs):** move `/_app/*` off the
  S3 **website** origin to a proper S3 **REST** origin with Origin Access Control.
  REST origins return real HTTP status codes instead of an HTML fallback, so a
  missing chunk 404s cleanly rather than poisoning module imports — turning silent
  failures into obvious ones and often resolving the symptom outright. This lives
  in `kit-on-lambda` (a dependency), so it may need an upstream change or a local
  override of the distribution's `/_app/*` behavior in
  `packages/dmarc-dashboard/cdk.ts`.

## Notes / caveats

- This is shared deployment infrastructure with real blast radius; do **not** make
  speculative CDK changes. Confirm the actual failure mode via steps 1–3 first.
- The fix cannot be verified without a deploy + inspecting live responses.
- Correlated context: `svelte.config.js` already sets `paths: { relative: false }`
  to fix a _previous_ asset-path issue on nested routes — evidence this app has a
  history of asset-routing sensitivity under kit-on-lambda.

## Resolution criteria

- A previously failing `/_app/immutable/.../*.js` request returns `200` with
  `Content-Type: text/javascript` and a JS body in the deployed environment.
- No `Importing a module script failed` errors in the console after a hard reload.
- Styling (calendar grid, summary cards, tabs) renders correctly on the deployed
  site, matching `bun run dev`.
