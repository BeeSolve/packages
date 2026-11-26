# Image Optimizer (`@beesolve/image-optimizer`)

## Status: Tasks 1-10 done (Task 10 needs the one-time AWS/GitHub setup), not published

## Problem Statement

Teams that keep images in S3 behind CloudFront want to change an image by changing URL parameters, for example `https://xyz.cloudfront.net/assets/photos/cat.jpg?w=400&fit=max`, without running a separate image service. The result must be served in the best format the browser accepts (WebP, falling back to the original format) and cached by CloudFront.

This plan creates a standalone package, `@beesolve/image-optimizer`, that provides: (1) a Lambda (Bun runtime, Function URL behind CloudFront) that reads the original from S3, transforms it with `Bun.Image`, and returns it; (2) a CloudFront Function that canonicalizes the query string and normalizes `Accept` so the cache key is stable; (3) a CDK construct that wires S3, Lambda, CloudFront behaviors and cache policies together.

This is the low-level building block for later work: presets for social networks, a Svelte `srcset` helper with placeholders, and processing of remote (urlencoded) public image URLs.

The URL protocol is a documented subset of [imgix Rendering API](https://docs.imgix.com/en-US/apis/rendering). We link to imgix for parameter semantics and document only what we support and where we differ.

## Verified Facts About Bun 1.4.4

Probed locally with `Bun.Image.backend = "bun"` (the portable backend used on Linux) and the [Bun image docs](https://bun.com/docs/runtime/image).

- Encode targets that work on Linux: WebP, JPEG, PNG. AVIF and HEIC throw `ERR_IMAGE_FORMAT_UNSUPPORTED`.
- `resize(w, h, { fit })` accepts only `fill` (skew) and `inside` (keep aspect ratio). Other values throw. `withoutEnlargement: true` works. `position` and `crop` options are ignored.
- There is no crop, pad or blur method. Methods present: `resize`, `rotate`, `flip`, `flop`, `modulate`, `metadata`, `placeholder`, `webp`, `jpeg`, `png`, `heic`, `avif`, `bytes`, `buffer`, `blob`, `dataurl`, `toBase64`, `toBuffer`, `write`.
- `rotate` accepts only multiples of 90 (`ERR_INVALID_ARG_TYPE` otherwise).
- `placeholder()` returns a ThumbHash-rendered data URL of at most 32px.
- `metadata()` reads only the header, and worked on the first 60 bytes of a PNG. JPEGs with large EXIF blocks are untested.
- Constructor option `maxPixels` rejects with `ERR_IMAGE_TOO_MANY_PIXELS`. Garbage input rejects with `ERR_IMAGE_UNKNOWN_FORMAT`.
- `Bun.s3.file(key).slice(start, end)` uses HTTP Range requests. `S3File.image()` is `new Bun.Image(file)` and reads lazily.
- The locally installed `bun-types` in the TypeScript cache is stale and has no `Image` types. Check `@types/bun` in the repo for the real typings.

## Findings From Task 1 Spikes (see ADR-004, ADR-005)

- Runtime 4.10405.0 had no `awslambda` global and streamed responses could not set status or headers. Runtime 4.10405.1 fixes this (`awslambda.streamifyResponse` and `HttpResponseStream.from` are defined, `asResponseStreamHandler` works, see the runtime's `docs/how-to/streaming.md`). The catalog is on 4.10405.1. Task 5 uses `asResponseStreamHandler` and Task 7 uses `InvokeMode.RESPONSE_STREAM`, which removes the 6 MB response limit. This has not been verified on a deployed stack yet: Task 7 and Task 8 must verify status, headers (`Cache-Control`, `X-Image-Optimizer`) and streaming through CloudFront with OAC, and fall back to `asHttpV2Handler` with `InvokeMode.BUFFERED` (6 MB limit, over-limit sources return 422) if OAC plus streaming does not work.
- OAC on a buffered Function URL works with `FunctionUrlOrigin.withOriginAccessControl`. OAC on a streaming Function URL is untested (Task 7).
- Runtime alias `1.4` ran Bun 1.4.5 on arm64.
- CloudFront Function: 10 KB size limit, custom headers must not start with `x-edge-`, `request.uri` keeps percent-encoding, duplicated query keys expose `value` (first) and `multiValue` (all), so the last value comes from `multiValue`.
- Sniff: first ranged read of 16 KB, retry with 128 KB and 1 MB on `ERR_IMAGE_DECODE_FAILED`.
- Intermediates: lossy WebP q95. Benefit is about 10x for PNG/WebP sources and about 3x for JPEG (JPEG already decodes at reduced size).
- KeyValueStore from Node.js needs `@aws-sdk/signature-v4a`.

## Architecture / Approach

### Scope for v1

- Processed input types: JPEG, PNG, WebP. Everything else (GIF, SVG, unknown) is passed through unchanged.
- Supported parameters (imgix names): `w`, `h`, `dpr`, `fit` (`clip`, `max`, `scale`), `q`, `fm` (`webp`, `jpg`, `png`), `rot` (multiples of 90), `flip` (`h`, `v`, `hv`).
- Our own parameter: `placeholder=1` returns the `Bun.Image` placeholder data URL as `text/plain`.
- No signing in v1 (see Key Design Decisions).
- Known imgix parameters we do not support yet, `crop` and `blur`, and `fit` values `crop`, `min`, `fill`, `fillmax`, `clamp`, `facearea`, return 400.
- Unknown query parameters (for example tracking parameters) are dropped by the edge function and never reach the cache key.
- Outcome header: every Lambda response carries `X-Image-Optimizer` so clients and operators can tell whether the image was processed. Values: `optimized` (decoded, resized or re-encoded), `passthrough; reason=unsupported-format; format=<sniffed>` (original bytes returned unchanged, for example GIF, SVG or an unknown format whose file extension says jpg), and `placeholder`. The header is part of the cached response, so a cache hit shows the same value. Responses served straight from S3 by the non-image behavior do not carry the header, so its absence means the optimizer did not see the request. Error responses (400, 404, 422) do not carry it. The name does not start with `x-edge-` or `x-amz-` (reserved, see ADR-004).

### `fit` semantics (for a 100x200 source resized to `w=300&h=300`)

| imgix `fit`      | Bun call                        | Result           |
| ---------------- | ------------------------------- | ---------------- |
| `clip` (default) | `inside`                        | 150x300          |
| `max`            | `inside` + `withoutEnlargement` | 100x200          |
| `scale`          | `fill`                          | 300x300 (skewed) |

If only one of `w` or `h` is given, the other is derived from the aspect ratio. `dpr` multiplies the requested `w` and `h` before geometry. With `fit=scale`, `withoutEnlargement` is not applied (imgix `scale` stretches).

### Request flow

1. CloudFront behavior matches an image extension under `/assets/` (case-sensitive patterns, both cases listed) and routes to the Lambda Function URL origin. All other `/assets/*` paths go straight to S3 (OAC) with no query strings in the cache key.
2. Viewer-request CloudFront Function: canonicalizes the query string (lowercase keys, drop unknown, dedupe, sort, normalize values), rejects known-unsupported parameters with 400, rejects path traversal, and rewrites `Accept` to `image/webp` or `*/*` (normalized to `webp` or `original`).
3. Cache key: path + canonical query + normalized `Accept`. The origin request policy forwards the same.
4. Lambda: ranged read of the first bytes of the S3 object (404 if missing), sniff with `Bun.Image(...).metadata()`, decide pass-through versus processing, compute geometry, resize, encode, respond with `Cache-Control` (from construct), `Vary: Accept`, `X-Content-Type-Options: nosniff`.

### Abuse protection: size buckets and persisted intermediates

Threat: an attacker requests `w=201`, `w=202`, `w=203`, ... for one large original. Every request is a CloudFront cache miss and a full decode of the original, which exhausts Lambda time and memory. Signing is dropped in v1, so this must be bounded some other way.

Idea: a fixed set of size boundaries (default 500, 1000, 1500, 2000, 2500, 3000 on the longest edge). When a request needs a size between two boundaries, the Lambda first creates a uniformly downscaled copy of the original at the next boundary above the requested size and persists it in a separate S3 bucket with a lifecycle rule (default 180 days). The requested size is then produced from that smaller intermediate instead of from the large original. Later requests anywhere in the same range read the small intermediate.

Example: original 1800x1800, request `w=250&h=280`. The final image is 250x250, which needs a scale of 250/1800, so the next boundary is 500. The Lambda produces and stores a 500x500 intermediate (one decode of the 1800x1800 file), then resizes the intermediate to 250x250. A later request for `w=251`, or any other thumbnail size up to 500, finds the 500x500 intermediate and never touches the 1800x1800 original again (apart from a header-only ranged read).

What it achieves: the expensive operation, decoding the full original, happens at most once per boundary per source version, no matter how many distinct sizes are requested. Every other request decodes a small image (at most a few hundred thousand pixels instead of millions). What it does not achieve: it does not reduce the number of CloudFront cache entries or Lambda invocations, because every distinct `w` is still a separate cache key and invocation. It bounds the cost of each invocation. A mode that snaps requested sizes to boundaries is listed under Future Work.

Rules:

- Required scale: `requiredScale = max(finalWidth / sourceWidth, finalHeight / sourceHeight)`, using the final resized dimensions from geometry (after `dpr`, `fit`, `rot`). Using both axes keeps `fit=scale` (skew) correct.
- Intermediate for boundary `B`: the source (EXIF orientation applied, metadata stripped) uniformly scaled so its longest edge is `B`, aspect ratio preserved, independent of `fit`, `w`, `h`, `rot`, `flip`. Its scale is `B / max(sourceWidth, sourceHeight)`.
- Choose the smallest `B` such that its scale is greater than or equal to `requiredScale` and `B * minSourceToBucketRatio <= max(sourceWidth, sourceHeight)`. If there is no such `B`, use the original directly. `minSourceToBucketRatio` is 1.5 by default so tiny savings are skipped.
- Always derive the final image from the intermediate, also on the first miss, so output bytes do not depend on whether the intermediate existed.
- Intermediate key: `v1/{sourceKey}/{sourceEtag}/{B}`. Including the source ETag (from the ranged read, `stat()` as fallback, then `lastModified` + size) makes stale intermediates unreachable when the original is overwritten. The lifecycle rule removes them.
- Storage: a separate private bucket created by the construct, written by the Lambda only, with an expiration lifecycle rule (`intermediateRetentionDays`, default 180). Lifecycle counts from creation, not access. Expired intermediates are regenerated lazily on the next miss.
- Encoding of the intermediate: lossy WebP at high quality or lossless, to avoid visible generation loss (two lossy steps). The exact choice is decided by a measurement in Task 1.
- Concurrent first requests may both write the same deterministic key. This is safe because the content is identical.

### Types and Schemas

```ts
export const fitModes = ["clip", "max", "scale"] as const;
export type FitMode = (typeof fitModes)[number];

export const outputFormats = ["webp", "jpg", "png"] as const;
export type OutputFormat = (typeof outputFormats)[number];

export const flipModes = ["h", "v", "hv"] as const;
export type FlipMode = (typeof flipModes)[number];

export interface ImageParams {
  w?: number;
  h?: number;
  dpr: number;
  fit: FitMode;
  q: number;
  fm?: OutputFormat;
  rot: 0 | 90 | 180 | 270;
  flip?: FlipMode;
  placeholder: boolean;
}

export const imageOutcomes = ["optimized", "passthrough", "placeholder"] as const;
export type ImageOutcome = (typeof imageOutcomes)[number];

export interface Geometry {
  requested: { width: number; height: number };
  resize: { width: number; height: number };
  fit: "fill" | "inside";
  withoutEnlargement: boolean;
  rotate: 0 | 90 | 180 | 270;
  flip?: FlipMode;
  requiredScale: number;
}
```

Valibot schemas use `v.picklist` for string literal sets. Limits (defaults, constants documented in the README): `w`, `h` between 1 and 8192, `dpr` between 1 and 3, `q` between 1 and 100 with default 75 (imgix default).

### Public API Surface

- `"."` exports the CDK construct `ImageOptimizer` and its props.
- `"."` (root `index.ts`) exports `generateUrl(props: GenerateUrlProps): string` and the mutation types. It is a pure, dependency-free helper (safe for browsers, SvelteKit, Node.js and Bun) that builds the final URL for an S3 path. Nothing is optional: `baseUrl`, `path`, `assetsPathPrefix` and `mutations` are required (pass `[]` for the unmodified original), and every mutation is a variant of a discriminated union with required fields only:

```ts
generateUrl({
  baseUrl: "https://xyz.cloudfront.net",
  path: "photos/cat.jpg",
  assetsPathPrefix: "assets",
  mutations: [
    { type: "fitBox", width: 400, height: 300, enlarge: false },
    { type: "pixelRatio", ratio: 2 },
    { type: "rotate", degrees: 90 },
    { type: "toWebp", quality: 80 },
  ],
});
```

| Group (at most one per call) | Mutations (`type`) and required fields                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| size                         | `fitBox` (`width`, `height`, `enlarge`), `fitWidth` (`width`, `enlarge`), `fitHeight` (`height`, `enlarge`), `stretch` (`width`, `height`) |
| pixelRatio (needs a size)    | `pixelRatio` (`ratio`, 1 to 3)                                                                                                             |
| rotation                     | `rotate` (`degrees`: 90, 180 or 270)                                                                                                       |
| flip                         | `flip` (`direction`: `horizontal`, `vertical`, `both`)                                                                                     |
| output                       | `toWebp` (`quality`), `toJpeg` (`quality`), `toPng`, `auto` (`quality`, WebP when accepted otherwise the original format), `placeholder`   |

Optional values and their defaults: `quality` defaults to 75 (the imgix default). Defaults are applied by the Lambda and never rendered into the URL: `generateUrl` skips `q=75`, `dpr=1` and `fit=clip` (`enlarge: true`) itself, and `canonicalizeQuery` drops them as a safety net, so `{ type: "toWebp" }` and `{ type: "toWebp", quality: 75 }` give the same URL). Compile-time guarantees: `enlarge` must be decided, `stretch` needs both dimensions, `toPng` has no quality, `rotate` cannot be 0 or 45, unsupported mutations (crop, avif) do not exist as types. Runtime guarantees (an array cannot express them in types): at most one mutation per group, `pixelRatio` needs a size, with errors that name both mutations, for example `"toWebp" and "placeholder" both set the output, use only one of them`. Numeric ranges (size 1 to 8192, pixel ratio 1 to 3, quality 1 to 100) are checked at runtime with errors naming the field, for example `"fitBox.width" must be an integer between 1 and 8192`. Array order has no effect (processing order is fixed: rotate, flip, size, output). `enlarge: false` maps to `fit=max`, `enlarge: true` to `fit=clip`, `stretch` to `fit=scale`. The query string is produced by `canonicalizeQuery`, so a generated URL is already the cache key form.

- Lambda handler and edge function are build artifacts under `dist/`, not public exports.

### Cross-Package Dependencies

- `@beesolve/lambda-bun-runtime` v4 (published on npm, source at `../lambda-bun-runtime` for reading): `BunFunction` runs on the Bun customer-managed runtime (CMR), no layer. Requires `aws-cdk-lib` 2.278.0 or newer and a stack with a concrete region among `eu-north-1`, `eu-central-1`, `eu-west-1`, `us-east-1`, `us-west-2`. The default alias is `1.4`. `BunFunctionWithLayer` and `BunLambdaLayer` are only the fallback for other regions and are not used here. Add it to the repo catalog and depend on it with `catalog:`. Read its `README.md` and `docs/how-to/getting-started.md` for the handler signature before Task 5. The sample and spikes deploy to `eu-central-1`.
- `@beesolve/lambda-keep-active` (workspace:^, v2.1.x): keeps the image Lambda from becoming inactive after about 14 days without traffic (a cold wake can take up to 90 seconds). The construct tags the function with `keepActive=true` through `LambdaKeepActive.keepActive(fn)`, and a scheduled invoker sends the event `{ "$$keepActivePing$$": true }` every 3 days. Compatibility problem found while planning: `keptActive` wraps `(event, context)` only and drops properties of the wrapped function (it stays unchanged, a separate explicit helper `keptActiveStreaming` is added in Task 4a), and `keptActiveFetch` only recognizes a `Request` with the URL `https://lambda/`, which the v4 Bun runtime never produces (it passes raw events). `asResponseStreamHandler` calls `awsRequest(event)` first, which throws a `TypeError` on the ping event (no `headers`), so the ping would fail with an error and async retries. The streaming handler is also marked by a symbol property (`Symbol.for("aws.lambda.runtime.handler.streaming")` equal to `"response"`) that a wrapper must preserve or the runtime treats the handler as a non-streaming one. Task 4a fixes this in `lambda-keep-active` with the new `keptActiveStreaming` helper.
- `@beesolve/lambda-function-url-protection`: evaluate in Task 7 whether the Function URL is protected with OAC or with this package's origin token. Prefer OAC if it works with `lambda-bun-runtime` function URLs and response streaming, otherwise use the package.
- `@beesolve/cdk-constructs`: reuse `esmBuild` or existing patterns for building handlers if they apply to a Bun-runtime bundle.
- `valibot`, `aws-cdk-lib`, `constructs` via `catalog:`. No AWS SDK for S3 (Bun's S3 API is used).

### CDK Construct

`ImageOptimizer` props: optional `keepActive?: LambdaKeepActive` (when given, the construct calls `keepActive.keepActive(fn)` on the image Lambda; document that it should be passed in production because the function can idle for weeks) (the outcome header needs no prop; make sure the response headers policy does not remove it and, if the construct adds `Access-Control-Expose-Headers`, include `X-Image-Optimizer`): `bucket` (source, read-only access), `assetsPathPrefix` (default `assets`), `cacheTtl` (default 1 year, `Cache-Control` max-age and CloudFront default/max TTL), `sizeBuckets` (default list above), `intermediateRetentionDays` (default 180), `maxSourceBytes`, `maxPixels`, `minSourceToBucketRatio`, required `distribution` (from `createImageOptimizerDistribution` or the caller's own), Lambda `memorySize` and `timeout`. Creates: intermediate bucket with lifecycle, Function URL `BunFunction` (Bun CMR), CloudFront Function, behaviors for image extensions, cache policy, origin request policy, response headers policy. The construct creates no distribution and no outputs; `createImageOptimizerDistribution({ scope, id, bucket, distributionProps? })` creates a distribution whose default behavior answers 404.

### Key Design Decisions

- **Protocol:** imgix subset. Reusing an existing public API means imgix documents parameter meaning and we document support and differences. Sharp is a library with no URL protocol and was rejected.
- **Bun limits:** `crop`, `fit` values requiring crop or pad, and `blur` are not supported by `Bun.Image` 1.4.4 and are excluded from v1. Unsupported imgix parameters return 400 instead of silently producing wrong output.
- **Geometry as a pure function:** all sizes are computed before any pixel work, covering your four cases (enlarge, skew, no-skew fit, never enlarge). Crop and pad rectangles are not part of v1 output but the module is shaped so they can be added without changing callers.
- **Edge normalization:** the viewer-request function sorts and canonicalizes the query and normalizes `Accept` so `?h=2&w=1` and `?w=1&h=2` share one cache entry and browsers do not fragment the cache.
- **Passthrough:** only JPEG, PNG and WebP are processed. Anything else is streamed from S3 unchanged. GIF is passed through so animation is not destroyed. The extension-based behavior split keeps non-images from reaching the Lambda. The Lambda still sniffs as a safety net.
- **Output format:** WebP when `Accept` lists `image/webp`, otherwise the original format. `fm` overrides. AVIF and HEIC are unavailable on Linux. EXIF is stripped. Orientation is applied first.
- **No signing in v1:** the images are the owner's own, the main goal is that changing URL parameters just works, and size buckets bound the abuse cost. Signing is expected to return when the service accepts remote public URLs (urlencoded image URLs instead of S3 paths), because then the distribution itself could be abused as an open proxy. See Future Work.
- **Backend signature generation and the KeyValueStore (for the future signing design):** the backend that generates signed URLs is a Node.js handler, not Bun (Bun is used only for image processing). It can use `@aws-sdk/client-cloudfront-keyvaluestore` (`GetKey`, `PutKey`) to read the signing key directly from the KeyValueStore that the edge function also reads, so no Secrets Manager or SSM copy is needed and the KeyValueStore is the single source of truth. The API is a global service signed with SigV4A, and temporary credentials need version 2 session tokens ([docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html)). The JavaScript SDK needs the CRT-based signer for SigV4A in Node.js. Task 1 verifies that it works from a Node.js 24 Lambda (arm64, native CRT package) and how the construct seeds the key (custom resource calling `PutKey` versus importing from S3, which would leave the key in a bucket). The Lambda should read the key once per cold start, not per request.
- **Package name:** `packages/image-optimizer`, npm name `@beesolve/image-optimizer`, version `0.0.0` until the first changeset, with the pre-1.0 README banner.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (tests across all packages)

**Rules for subagents:**

- Start the session with `git pull --rebase origin main`. Never push without explicit user approval.
- Each task must be self-contained
- No commits, leave changes uncommitted for review
- Follow the project's code style (see `.kiro/steering/` and the workspace rules): no explanatory comments, no barrel exports except package public API `index.ts`, no `enum`, `== null` checks, descriptive names in array callbacks, named object parameters for functions with 2+ arguments, `v.picklist` for string literal sets
- Do not use the em dash in any written text, use a hyphen
- If check gates fail on unrelated existing issues, note them but don't fix
- Use `workspace:^` for intra-monorepo dependencies
- Use `catalog:` for shared external dependencies
- Run `bun install` after adding dependencies
- Run `bun run recalculate-dependencies` after changing intra-monorepo deps

**Operational notes:**

- Build tool is bunup, workspace entry lives in `bunup.config.ts`. Lambda bundles are built through the package `prepublishOnly` script (see `packages/analytics-processor/build.ts` and `scripts/buildLambdas.ts`).
- Library modules live in `packages/image-optimizer/src/` (query, accept, limits, url, params, geometry, buckets, source, intermediates, pipeline, handler, edge). The root `index.ts` is the runtime entry (`generateUrl`, later signing helpers); the root `cdk.ts` is the construct and the `./cdk` export. `query.ts` is internal (edge function, Lambda, `generateUrl`) and not exported. bunup emits `index.ts` as `dist/index.js` and `cdk.ts` as `dist/cdk.js`, which finds the prebuilt `dist/handler/handler.js` and `dist/edge/function.js` at fixed relative paths. Tests import from `../src/...`, except `tests/cdk.test.ts`, which imports the built `../dist/cdk.js` (root ADR-001). Never use `as T` casts, narrow with `if` chains and a local `assertUnreachable(value: never)` (modules bundled into the CloudFront Function cannot import `@beesolve/helpers`).
- ADRs live in `packages/image-optimizer/docs/` using the repo ADR format
- Package names differ from directory names, always read `package.json` before creating changesets
- Use `bun run add-package image-optimizer` (`scripts/add-package.ts`) to scaffold, then inspect the result
- Tests that decode images must set `Bun.Image.backend = "bun"` for deterministic output across macOS and Linux

## Tasks

### Task 1: Scaffold package, ADRs, and spikes

- [x] Bump `aws-cdk-lib` in the workspace catalog to 2.278.0 or newer and add `@beesolve/lambda-bun-runtime` (4.10405.0) to the catalog, then `bun install`. If the samples package uses the `cdk` CLI, check it can read cloud assemblies from the newer `aws-cdk-lib` (the runtime repo upgraded its CLI for this).
- [x] Run `bun run add-package image-optimizer`, set the npm name `@beesolve/image-optimizer`, version `0.0.0`, exports `"."` and `"./cdk"`, add the entry to `bunup.config.ts`, add the mapping `packages/image-optimizer/ -> @beesolve/image-optimizer` to the Changesets list in `.kiro/steering` or the workspace rule file that holds the known mappings (find it with a grep for `lambda-keep-active`)
- [x] Write `docs/adr-001-motivation.md` (why the package exists, why standalone, boundaries) and `docs/adr-002-imgix-protocol.md` (imgix subset, rejected alternatives: sharp-style custom names, imgproxy, Thumbor, Cloudinary, IIIF)
- [x] Write `docs/adr-003-size-buckets-and-intermediates.md` from the "Abuse protection" section of this plan
- [x] Local spike script `packages/image-optimizer/spikes/` (deleted before finishing the task, findings go into ADRs): measure intermediate options. Decode a real 3000x2000 JPEG fixture (generate with `Bun.Image` from a synthetic gradient plus noise), produce a 1000px intermediate as WebP quality 90, 95, 100 and PNG, derive a 750px final from each and from the original, and compare file size and a simple pixel-difference metric. Record the choice in ADR-003.
- [x] Local spike: `Bun.Image(...).metadata()` on the first 4 KB, 16 KB and 64 KB of a JPEG with a large EXIF block (synthesize by inserting an APP1 segment). Record the smallest sniff range that works and the failure mode when the header is truncated (feeds Task 5).
- [x] Deployed spike (ask the user before deploying, use the maintainer's development account, region `eu-central-1`): a throwaway stack with a `BunFunction` (Bun CMR) behind a Function URL reading `Bun.s3.file(key).slice(0, 4096)` and `.stat()`. Verify: the CMR default alias `1.4` runs the Bun version the plan was probed against (print `Bun.version`), Lambda session credentials are picked up, ranged read works, `stat()` returns an ETag, WebP encode works on arm64 Linux, response streaming works. Record results in `docs/adr-004-runtime-findings.md`.
- [x] Deployed spike (same rules): a CloudFront Function using `crypto.createHmac("sha256", ...)` and a KeyValueStore read, plus `aws cloudfront test-function`. Record: whether it runs, the bundle size limit, KVS lookup latency. In the same throwaway stack add a Node.js 24 arm64 Lambda that reads and writes the KeyValueStore with `@aws-sdk/client-cloudfront-keyvaluestore` and records whether SigV4A works there (with `@aws-sdk/signature-v4-crt` or the SDK's default path), the latency of `GetKey`, and how to seed the key from CDK. Write `docs/adr-005-signing-deferred.md` with status Deferred, describing the future design (HMAC-SHA256 over path + canonical query, optional `expires` with no expiry by default, key stored only in the KeyValueStore, Node.js backend reads it with the SDK and signs, edge function verifies).
- [x] Local or deployed spike (deployed part needs the same approval): check how a remote URL embedded in the path behaves, for example `/assets/ext/https%3A%2F%2Fexample.com%2Fa.jpg`. Verify what CloudFront, a CloudFront Function (`request.uri`), and a Lambda Function URL (`rawPath`) each see: whether `%2F` and `%3A` survive or get decoded, and whether `//` gets collapsed. Record the result in `docs/adr-004-runtime-findings.md` and name the fallback if it breaks (`?url=` query parameter or a base64url path segment). This feeds the future remote-source work only, nothing in v1 depends on it.
- [x] Add `README.md` skeleton with the pre-1.0 stability banner and a `DOCS.md` skeleton (completed in Task 9)

**Files:** `packages/image-optimizer/package.json`, `packages/image-optimizer/tsconfig.json`, `packages/image-optimizer/README.md`, `packages/image-optimizer/DOCS.md`, `packages/image-optimizer/docs/adr-001-motivation.md`, `adr-002-imgix-protocol.md`, `adr-003-size-buckets-and-intermediates.md`, `adr-004-runtime-findings.md`, `adr-005-signing-deferred.md`, `bunup.config.ts`

**Acceptance criteria:** `bun install` succeeds, `bun run check` and `bun run type-check` pass, ADRs follow the repo ADR format, ADR-003 states the chosen intermediate encoding with measured numbers, ADR-004 and ADR-005 contain concrete findings or an explicit "not verified" with the reason.

---

### Task 2: Query canonicalization, `Accept` negotiation (edge-safe modules)

- [x] `packages/image-optimizer/src/query.ts`: `canonicalizeQuery(query: string): { query: string } | { error: string }`. No imports (it is bundled into the CloudFront Function, which has a small size limit and no module system). Behavior: parse `a=b&c=d`, lowercase keys, keep only supported keys (`w`, `h`, `dpr`, `fit`, `q`, `fm`, `rot`, `flip`, `placeholder`), drop all other keys, keep the last value of duplicated keys, drop parameters whose value equals the default (`fit=clip`, `dpr=1`, `rot=0`, `q=75`, `placeholder=0`) so equivalent URLs share one cache entry, normalize numeric values (`0300` -> `300`, `300.0` -> `300`), lowercase enum-like values, drop empty values, sort keys alphabetically, rebuild the string. Return `{ error }` for known-unsupported imgix parameters (`crop`, `blur`) and for `fit` values `crop`, `min`, `fill`, `fillmax`, `clamp`, `facearea`.
- [x] `packages/image-optimizer/src/accept.ts`: `negotiateFormat(acceptHeader: string | undefined): "webp" | "original"`. Parse media ranges and `q` values, return `webp` only if `image/webp` is listed with `q > 0`. `*/*` alone returns `original`.
- [x] ~~Export `canonicalizeQuery` and `supportedQueryKeys` from a `./query` entry~~ Removed: no consumer outside the package needs them, `generateUrl` already produces canonical URLs.
- [x] Tests `tests/query.test.ts`: default values dropped (`?fit=clip&w=300` equals `?w=300`), order-insensitivity (`?h=2&w=1` equals `?w=1&h=2`), duplicates, case, numeric normalization, unknown key dropped (`utm_source`), unsupported `crop`, `blur`, `fit=crop` produce errors, empty query returns empty string.
- [x] Tests `tests/accept.test.ts`: typical Chrome, Safari, Firefox, curl (`*/*`), `image/webp;q=0`, missing header, malformed header.

**Files:** `packages/image-optimizer/src/query.ts`, `packages/image-optimizer/src/accept.ts`, `packages/image-optimizer/tests/query.test.ts`, `packages/image-optimizer/tests/accept.test.ts`

**Implementation notes:** `query.ts` also validates numeric format (digits only, integers for `w`, `h`, `q`, `rot`), enum values (`fit`, `fm`, `flip`), `rot` in 0/90/180/270 and `placeholder` in 0/1, and returns `{ error }` otherwise, so garbage values never reach the Lambda or the cache key. Range checks (for example `w` up to 8192) stay in the Lambda and in `generateUrl`. `query.ts` owns and exports `fitModes`, `outputFormats`, `flipModes`, `rotations`, their types and `queryDefaults`; `limits.ts` (Task 3) re-exports them from `./query` so there is one definition. For duplicated query keys in the CloudFront event object, Task 6 must build the query string from `multiValue` (last entry wins).

**Acceptance criteria:** `bun test packages/image-optimizer/tests/query.test.ts packages/image-optimizer/tests/accept.test.ts` passes. `query.ts` and `accept.ts` import nothing.

---

### Task 3: Shared limits and `generateUrl` helper

- [x] `packages/image-optimizer/src/limits.ts`: no imports. Exports only `imageLimits` as const (`maxDimension: 8192`, `minDpr: 1`, `maxDpr: 3`, `minQuality: 1`, `maxQuality: 100`, `defaultQuality: 75`). No re-exports: consumers import the literal arrays, types, `queryDefaults` and `isRotation` directly from `./query` (defined there in Task 2). `params.ts` (Task 4) imports from here so the helper and the Lambda cannot drift apart.
- [x] `packages/image-optimizer/src/url.ts` (exported from the root `index.ts`): `generateUrl(props: GenerateUrlProps): string` as specified in "Public API Surface" (required `baseUrl`, `path`, `assetsPathPrefix` and `mutations`, a discriminated union of mutations with required fields). Behavior: join `baseUrl` (strip trailing slashes), `assetsPathPrefix` and `path` (strip leading and trailing slashes, encode each segment with `encodeURIComponent`, keep `/` separators, throw on empty interior segments and `.` or `..`); `toPairs` maps each mutation with an `if` chain ending in `assertUnreachable`; `assertCompatible` rejects two mutations of one group and a `pixelRatio` without a size; numeric ranges are validated against `imageLimits` with errors naming the field; the raw query goes through `canonicalizeQuery` and throws on `{ error }`; omit the `?` when the canonical query is empty.
- [x] Tests `tests/url.test.ts`: each mutation, `enlarge` true and false, combinations of one mutation per group, order independence, conflicts name both mutations, `pixelRatio` without size, field-named range errors, limits, path encoding, slash normalization, empty and custom prefix, empty `baseUrl`, traversal, idempotence through `canonicalizeQuery`, and ten `@ts-expect-error` cases that pin the compile-time contract (missing `enlarge`, `stretch` with one dimension, `toPng` with quality, non-numeric quality, unknown formats and mutations, `rotate` 0 or 45, missing `mutations`).

**Files:** `packages/image-optimizer/src/limits.ts`, `packages/image-optimizer/src/url.ts`, `packages/image-optimizer/tests/url.test.ts`

**Implementation notes:** `generateUrl` also throws for empty paths, empty interior segments and `.` or `..` segments (instead of silently changing the S3 key), accepts an empty `baseUrl` (root-relative URL) and an empty `assetsPathPrefix`, and takes `dpr` between 1 and 3 (fractions allowed). `imageLimits` also exports `minDpr`. Enum values and `rot` are validated through `canonicalizeQuery` and `isRotation`.

**Acceptance criteria:** `bun test packages/image-optimizer/tests/url.test.ts` passes. `url.ts` and `limits.ts` import only `./query` and each other (no Valibot, no Node or Bun APIs).

---

### Task 4: Params schema, geometry, bucket selection (pure Lambda-side modules)

- [x] `params.ts`: Valibot schema and `parseParams(query: string): ImageParams` (throws `Error` with a message used for the 400 body). Types as in the "Types and Schemas" section. Limits come from `limits.ts` (Task 3), not redefined here.
- [x] `geometry.ts`: `computeGeometry({ source, params }): Geometry` where `source` is `{ width, height }`. Apply `dpr`, derive the missing dimension from the aspect ratio when only `w` or `h` is given, apply `rot` before geometry (rot 90 and 270 swap the source dimensions), map `fit` to Bun (`clip` -> `inside`, `max` -> `inside` + `withoutEnlargement`, `scale` -> `fill`, no enlargement protection), compute final dimensions exactly as `Bun.Image` does (round the derived side) and `requiredScale = max(finalWidth / sourceWidth, finalHeight / sourceHeight)` (using the oriented source). If neither `w` nor `h` is given, the resize equals the source size.
- [x] `buckets.ts`: `selectBucket({ source, requiredScale, sizeBuckets, minSourceToBucketRatio }): number | undefined` implementing the rules in "Abuse protection". `defaultSizeBuckets` constant.
- [x] Tests `tests/geometry.test.ts` as a table: 100x200 source with `w=300&h=300` for `clip` (150x300), `max` (100x200), `scale` (300x300); only `w`; only `h`; `dpr=2`; `rot=90`; `flip` passthrough; source smaller than request. Verify against real `Bun.Image` output dimensions with `backend = "bun"` for each row, not only the pure result.
- [x] Tests `tests/buckets.test.ts`: with the default buckets (500, 1000, 1500, 2000, 2500, 3000): 1800x1800 source and request 250x280 selects 500; request 501x501 selects 1000; request 1700x1700 selects `undefined` (original, the next boundary 2000 exceeds the source); source 400x400 and request 250 selects `undefined` because of `minSourceToBucketRatio`; skew case (`scale`, 1800x900 source to 300x300) selects 1000 (scale 0.556 covers both axes, 500 only gives 0.278), not 500.
- [x] Tests `tests/params.test.ts`: defaults, limits, invalid values, `placeholder`.

**Files:** `packages/image-optimizer/src/params.ts`, `src/geometry.ts`, `src/buckets.ts`, `tests/params.test.ts`, `tests/geometry.test.ts`, `tests/buckets.test.ts`

**Implementation notes:** `parseParams` first normalizes through `canonicalizeQuery` and then validates with Valibot (`v.picklist` for the enums, ranges from `imageLimits`, defaults applied by the schema, `ImageParams` is `v.InferOutput`). `Geometry` has an extra `requested` field (the box to pass to `Bun.Image#resize` on the original) next to `resize` (the final dimensions); from an intermediate the pipeline resizes to `resize` with `fit: "fill"` so the output size is exact. `source` is the size after EXIF orientation: verified that `Bun.Image#metadata()` already applies orientation (a stored 4032x3024 with orientation 6 reports 3024x4032), so the pipeline passes `metadata()` dimensions unchanged. The tests create images with `tests/fixtures.ts` (`createImage`) and compare geometry with the real `Bun.Image` output for 20 rows.

**Acceptance criteria:** `bun test packages/image-optimizer/tests` passes. Geometry rows match real Bun output.

---

### Task 4a: `lambda-keep-active` support for streamified handlers

- [x] `packages/lambda-keep-active/runtime.ts`: add a new explicit helper `keptActiveStreaming(handler, options?)` for `(event, responseStream, context)` handlers that copies all own property descriptors (symbols included) of the wrapped handler onto the wrapper, so the streaming marker survives. Ping events return without calling the handler and without touching `responseStream`. `keptActive` and `keptActiveFetch` are not changed (no overloads).
- [x] Verify against the runtime source in `node_modules/@beesolve/lambda-bun-runtime/dist/runtime.mts` that a streamified handler which returns without writing is accepted (no error posted, no hung invocation). If it is not, fix the approach (for example end the response stream in the wrapper if one is passed) and record it.
- [x] Tests `packages/lambda-keep-active/tests/runtime.test.ts` (the package has no tests yet): ping skips the handler for `keptActive` (2 arguments) and `keptActiveStreaming` (3 arguments), non-ping events reach the handler with all arguments, the `Symbol.for("aws.lambda.runtime.handler.streaming")` property is preserved, return values and thrown errors pass through, `enableLogs` logs the ping.
- [x] Docs: update `README.md`, `DOCS.md` and `docs/how-to/getting-started.md` with the pattern `export const handler = keptActiveStreaming(asResponseStreamHandler(fetch))` for the v4 Bun runtime, and state that `keptActiveFetch` only applies to runtimes that deliver Fetch `Request`s with the URL `https://lambda/`.
- [x] Changeset for `@beesolve/lambda-keep-active` (read `package.json` first, currently 2.1.x, so a non-breaking addition is `minor`).

**Implementation notes:** `keptActive` is unchanged, the new `keptActiveStreaming` is a separate function with its own explicit signature (the whole repo still type-checks). Verified against the real runtime: `runtime.mts` calls `handler(event, responseStream, context)`, then `responseStream.end()` itself, so a ping that returns without writing produces an empty streamed response and no error. A local run with a fake Runtime API confirmed a ping returns an empty response with no error, and a normal event streams with the `application/vnd.awslambda.http-integration-response` content type and the status and headers prelude. Pings are only recognized by the outermost handler, wrapping the inner Fetch function does not work because `asResponseStreamHandler` builds a `Request` from the event first.

**Files:** `packages/lambda-keep-active/runtime.ts`, `packages/lambda-keep-active/tests/runtime.test.ts`, docs files above, `.changeset/*.md`

**Acceptance criteria:** `bun test packages/lambda-keep-active` passes, existing consumers type-check (`bun run type-check`).

---

### Task 5: Lambda handler (source, sniff, intermediates, pipeline)

- [x] `source.ts`: interface `ImageSource { head(key): Promise<{ bytes: Uint8Array; etag: string } | undefined>; image(key): Bun.Image-compatible input; stream(key): Response }` and a Bun S3 implementation using `Bun.s3.file(key).slice(0, sniffBytes)` for sniff (range from Task 1 findings). A missing key returns `undefined` (404). An in-memory fake implementation for tests lives in `tests/fakes.ts`.
- [x] `intermediates.ts`: `IntermediateStore` interface `{ get(key): Promise<Uint8Array | undefined>; put(key, bytes): Promise<void> }`, Bun S3 implementation, in-memory fake. Key builder `v1/{sourceKey}/{sourceEtag}/{bucket}`.
- [x] `pipeline.ts`: `processImage({ source, store, key, params, accept, config }): Promise<Response>`. Steps: head -> metadata (reject over `maxPixels`/`maxSourceBytes` with 422) -> not JPEG/PNG/WebP then stream passthrough -> geometry -> bucket selection -> get or create intermediate -> final resize from intermediate -> rotate/flip -> encode (format from `fm`, else `negotiateFormat`, else original format; `q` applies to lossy formats) -> response. `placeholder=1` returns `text/plain` data URL from `Bun.Image.placeholder()` of the final image. Always set `maxPixels` on `Bun.Image`. Set `Cache-Control`, `Vary: Accept`, `X-Content-Type-Options: nosniff`, correct `Content-Type` and `X-Image-Optimizer` (`optimized`, `placeholder`, or `passthrough; reason=unsupported-format; format=<sniffed>` for the passthrough branch; the header value is built by a small pure function `outcomeHeader` in `pipeline.ts` so it is unit-testable).
- [x] `handler.ts`: exports `handler = keptActiveStreaming(asResponseStreamHandler(fetchHandler))` with `keptActiveStreaming` from `@beesolve/lambda-keep-active/runtime` (Task 4a), so keep-active pings return before any request parsing. Reads config from env (`SOURCE_BUCKET`, `INTERMEDIATE_BUCKET`, `ASSETS_PREFIX`, `CACHE_TTL_SECONDS`, `SIZE_BUCKETS`, `MAX_SOURCE_BYTES`, `MAX_PIXELS`, `MIN_SOURCE_TO_BUCKET_RATIO`) once at the top with a Valibot schema, builds services once at module level, maps URL path to S3 key (strip prefix, decode, reject `..`), maps errors to 400 (`parseParams`), 404 (missing key), 422 (limits). Use the Fetch-API handler shape documented by `@beesolve/lambda-bun-runtime` with response streaming for passthrough.
- [x] Add `@beesolve/lambda-keep-active` (`workspace:^`) and `@beesolve/lambda-fetch-api` (`workspace:^`) to the package dependencies, run `bun install` and `bun run recalculate-dependencies`.
- [x] Tests `tests/handler.test.ts` (with `awslambda` stubbed): a ping event `{ "$$keepActivePing$$": true }` returns without calling the fetch handler or touching S3, and the exported handler still carries the streaming marker.
- [x] Tests `tests/pipeline.test.ts` with generated JPEG, PNG and WebP fixtures: missing key 404; passthrough for a fake GIF/SVG body; WebP when accepted; original format otherwise; `fm=png` override; resize dimensions; `placeholder=1` returns a `data:image/` string; oversize source 422; second request for a different width in the same bucket range does not read the full original (assert via counting fake source reads) and reads the intermediate; changed ETag produces a new intermediate key; `rot=90` output dimensions; response headers; `X-Image-Optimizer` is `optimized` for a resized JPEG, `placeholder` for `placeholder=1`, and `passthrough; reason=unsupported-format; format=gif` for a GIF body requested as `.jpg`; no header on 404, 400 and 422.

**Implementation notes:** `ImageSource` is `stat(key)` (etag, size, content type, `undefined` for missing), `readRange({ key, length })`, `read(key)` and `stream(key)`, so the sniff retries (16 KB, 128 KB, 1 MB on `ERR_IMAGE_DECODE_FAILED`) do not repeat the `stat`. Modules added beside the planned ones: `src/config.ts` (`parseConfig`, `environmentNames`, the construct in Task 7 must set exactly these variables), `src/fetchHandler.ts` (`createFetchHandler` and `pathToKey`, testable without environment variables), `src/responses.ts`. `src/handler.ts` is the thin module-level wiring (`Bun.Image.backend = "bun"`, config, services, `keptActiveStreaming(asResponseStreamHandler(...))`). Behavior worth knowing: the final image is always produced with `fit: "fill"` at the exact target dimensions from the original or from the intermediate; a failing intermediate `put` is logged and the image is still served; placeholders use a target shrunk to 64 px so large `w` values stay cheap; `Bun.Image#rotate(90)` is clockwise, `flop()` is `flip=h` and `flip()` is `flip=v` (verified with pixel tests); response bodies use `Image#blob()` because `Uint8Array<ArrayBufferLike>` is not a valid `BodyInit`; `%2e%2e` segments are normalized by `URL` before the handler sees them, so traversal ends up outside the assets prefix (404) or is rejected (400). Dependencies `@beesolve/lambda-fetch-api` and `@beesolve/lambda-keep-active` are added (`workspace:^`), `dependencies.json` order was checked. Not verified yet (Task 8): `stat()` on a missing key on S3 (`NotFound` or `NoSuchKey` are both handled), alpha PNG to JPEG output.

**Files:** `packages/image-optimizer/src/source.ts`, `src/intermediates.ts`, `src/pipeline.ts`, `src/handler.ts`, `tests/fakes.ts`, `tests/pipeline.test.ts`

**Acceptance criteria:** `bun test packages/image-optimizer/tests/pipeline.test.ts` passes. The "does not re-read the original" test passes.

---

### Task 6: CloudFront Function

- [x] `edge.ts`: CloudFront Function entry (runtime 2.0 JavaScript, a plain `handler(event)` with no ES exports) that imports `canonicalizeQuery` and `negotiateFormat`. On `{ error }` return a 400 response. Rewrite `request.querystring` from the canonical result (the object form CloudFront expects: `{ key: { value } }`), rewrite the `accept` header to `image/webp` or `*/*`, reject `..` or encoded traversal in `request.uri` with 400.
- [x] Build script `build.ts` (esbuild, following how `.kiro/plans/edge-analytics.md` and `packages/analytics-processor/build.ts` bundle) producing `dist/edge/function.js` as a single script that defines `handler`, no `export`, no `import`. Wire it into `prepublishOnly` and the Lambda bundle (`dist/handler`) for the Bun runtime.
- [x] Tests `tests/edge.test.ts` calling `handler` with synthetic CloudFront events: query reorder, unknown key dropped, unsupported param 400, `Accept` normalization, traversal 400, request without query.
- [x] Assert the built function size is below the CloudFront Function limit recorded in ADR-004 (read the limit from the ADR or a constant).

**Implementation notes:** `build.ts` exports `buildEdgeFunction()` (esbuild bundle, no write) and `cloudFrontFunctionMaxBytes` (10 KB, ADR-004), and runs `buildAll()` only as a script (`bun build.ts`, also `prepublishOnly` and `build`). The CloudFront JavaScript runtime 2.0 lists no `for...of`, spread, destructuring, shorthand properties, default parameters, optional catch binding, `?.` or `??`. esbuild lowers what it can through `supported` flags (shorthand, optional catch binding, `??`, `?.`, default parameters, object spread) and fails the build for what it cannot (`for...of`, destructuring), so `accept.ts` and `query.ts` use index loops, `some`, `find` and explicit property access. TypeScript 7 has no JavaScript compiler API, so it cannot be used for downleveling. `handler` also accepts `querystring` as a string and writes the canonical query back as a string (documented as valid by CloudFront), or `{}` when empty. The built function is 7.4 KB. The Lambda bundle is `dist/handler/handler.js` (Bun bundler, target bun, minified, 23 KB) and is what the Task 7 construct passes to `BunFunction` as a precompiled `.js` entrypoint. Verified with the real `runtime.mts` and a fake Runtime API: the bundle loads, a keep-active ping returns an empty response, and a request outside the prefix returns 404 with status and headers through the streaming prelude. Not verified yet (Task 8): whether CloudFront passes query values percent-encoded or decoded to the function (the code assumes encoded, `canonicalizeQuery` decodes), and acceptance of the ES2020 syntax that remains (`const`, arrow functions, template literals) by `aws cloudfront create-function`.

**Files:** `packages/image-optimizer/src/edge.ts`, `packages/image-optimizer/build.ts`, `packages/image-optimizer/tests/edge.test.ts`

**Acceptance criteria:** `bun test packages/image-optimizer/tests/edge.test.ts` passes, `bun run build` produces `dist/edge/function.js` and the Lambda bundle.

---

### Task 7: CDK construct

- [x] `cdk.ts` at the package root (the `./cdk` export): `ImageOptimizer` construct and `ImageOptimizerProps` as described in "CDK Construct". Use `BunFunction` from `@beesolve/lambda-bun-runtime` v4 (CMR, no layer; read its docs first), response streaming enabled on the Function URL.
- [x] Function URL protection: follow the evaluation rule in "Cross-Package Dependencies". Document the choice in `docs/adr-006-function-url-protection.md`.
- [x] CloudFront: S3 origin with OAC for the source bucket, Function URL origin, one behavior per extension in both cases (`jpg`, `jpeg`, `png`, `webp`) under `/{assetsPathPrefix}/*.{ext}` routed to the Lambda with the optimizer cache policy (query string allow list = supported keys, header allow list = `Accept`, TTLs from `cacheTtl`) and the viewer-request CloudFront Function, and a default `/{assetsPathPrefix}/*` behavior to S3 with no query strings. Response headers policy as needed.
- [x] Intermediate bucket: private, block public access, SSL enforced, lifecycle expiration `intermediateRetentionDays`, read/write granted to the Lambda only, source bucket read-only for the Lambda.
- [x] `keepActive` wiring: the Lambda carries the tag `keepActive=true` when the prop is passed and no tag otherwise.
- [x] Props validation: `sizeBuckets` ascending and unique, retention at least 1, `cacheTtl` positive.
- [x] Tests `tests/cdk.test.ts` using `aws-cdk-lib/assertions`: behaviors created for each extension and both cases, lifecycle rule present with the configured days, Function URL auth, environment variables, cache policy query string and header settings, props validation errors, the `keepActive=true` tag present with the `keepActive` prop and absent without it.

**Implementation notes:** The S3 key is the full decoded request path including the assets prefix (`/assets/photos/cat.jpg` reads `assets/photos/cat.jpg`), the same key the `/{prefix}/*` S3 behavior serves, so `generateUrl`'s `path` is relative to the prefix. The distribution is a required prop (decided before the first release): the construct only adds its behaviors with `addBehavior`, and `createImageOptimizerDistribution` creates the default distribution whose default behavior answers 404 from a CloudFront Function. `environmentNames` moved to `src/environment.ts` so the CDK entry does not pull Valibot. The construct reads `dist/handler/handler.js` and `dist/edge/function.js` next to the built `dist/cdk.js`, so the package must be built before synth and before `tests/cdk.test.ts`. Response headers policy not needed: the function sets all headers. Not done: `Access-Control-Expose-Headers` (no CORS headers are added at all yet).

**Files:** `packages/image-optimizer/cdk.ts`, `packages/image-optimizer/tests/cdk.test.ts`, `packages/image-optimizer/docs/adr-006-function-url-protection.md`

**Acceptance criteria:** `bun test packages/image-optimizer/tests/cdk.test.ts` passes, `bun run type-check` passes.

---

### Task 8: Sample app and deployed verification

- [x] Add `packages/samples/imageOptimizer/` following an existing sample (see `packages/samples/analytics` and `packages/samples/app.ts` for how stacks are registered and how `mise.toml` is used). The stack deploys the construct with a source bucket and a sample image uploaded by a `BucketDeployment` (use a small generated or checked-in JPEG).
- [x] Verification checklist in the sample README, executed against the deployed stack (ask the user before deploying): `?w=300` returns WebP when `Accept: image/webp` and JPEG otherwise, `?w=300&h=300&fit=max` never enlarges, `?h=2&w=1` and `?w=1&h=2` return a cache hit on the second call (`x-cache: Hit from cloudfront`), `?crop=top` returns 400, a PDF under `/assets/` is served from S3, missing image returns 404, `X-Image-Optimizer: optimized` on resized images and on cache hits, `passthrough; reason=unsupported-format; format=gif` for a GIF uploaded under a `.jpg` key, no header on the PDF served from S3, a keep-active ping (`aws lambda invoke --invocation-type RequestResponse --payload '{"$$keepActivePing$$":true}'`, then check the log group for errors and that the function's `keepActive=true` tag is set) completes without an error and without reading S3, requests for `w=250` and `w=260` on the large sample create a single intermediate object in the intermediate bucket.
- [x] Record the verification results in the sample README.

**Implementation notes:** Deployed as `SamplesImageOptimizer` (eu-central-1, stack kept for manual testing). Sample images live in `packages/samples/imageOptimizer/photos` as `01.jpeg` to `04.jpeg` (renamed by the user, EXIF stripped) and are uploaded by a `BucketDeployment` to `assets/photos/`, non-image files to `assets/files/`. All 25 checks in `packages/samples/imageOptimizer/README.md` pass. Two defects found and fixed during the run: the function looked up keys without the assets prefix (404 for every image), and passthrough used the stored content type instead of the sniffed one.

**Files:** `packages/samples/imageOptimizer/*`, `packages/samples/app.ts`

**Acceptance criteria:** the sample type-checks and synthesizes (`cdk synth`). Deployed verification items pass, or failures are written up for the user.

---

### Task 9: Documentation and release metadata

- [x] `README.md`: pre-1.0 banner directly under the title and one-line description, quick start (construct usage), supported parameters table with links to imgix docs, `fit` behavior table, differences from imgix (rot multiples of 90 only, unsupported parameters return 400, `placeholder=1`, `fm` values, format negotiation), cache behavior, the `X-Image-Optimizer` header (values, meaning of its absence), size buckets explained for users, limits, and a `generateUrl` section (props table, the `enlarge` to `fit` mapping, SvelteKit and Node.js usage).
- [x] `DOCS.md` and `docs/how-to/getting-started.md` following the `agentic-package-docs` conventions (see `packages/hmac/DOCS.md`). Run the `sync-package-docs` skill.
- [x] Changeset for `@beesolve/image-optimizer` (new package, `0.1.0` minor bump since the package starts at `0.0.0`).
- [x] Confirm `scripts/publish.ts` topological order handles the new package. Do not publish.

**Implementation notes:** README, `DOCS.md`, `docs/how-to/getting-started.md` and `docs/how-to/generate-urls.md` written from the source; every code sample was run (URL outputs match exactly, the placeholder sample against the deployed stack, the construct sample synthesizes 26 resources); all imgix links resolve. `@beesolve/lambda-fetch-api` and `valibot` moved to devDependencies (bundled into the prebuilt handler, the published entry points import only `@beesolve/lambda-bun-runtime` and, for types, `@beesolve/lambda-keep-active`). `bun pm pack --dry-run`: 14 files, 83 KB, no ADRs, sources, tests or sample photos. Publish order in `dependencies.json`: `lambda-fetch-api`, `lambda-keep-active`, `image-optimizer`. Changesets: `image-optimizer-initial.md` (minor) and `lambda-keep-active-streaming-handlers.md` (minor).

**Files:** `packages/image-optimizer/README.md`, `packages/image-optimizer/DOCS.md`, `packages/image-optimizer/docs/how-to/getting-started.md`, `.changeset/*.md`

**Acceptance criteria:** `bun run check`, `bun run type-check`, `bun test` pass for the whole repo, docs contain no em dash.

---

### Task 10: Visual integration tests

- [x] Generated fixtures (`packages/samples/imageOptimizer/fixtures.ts`): animated GIF and animated WebP (160x120 and 640x360, transparency), still GIF, PNG and WebP with full and partial transparency. Animated WebP is assembled from `Bun.Image` stills (`ANIM`/`ANMF` container), verified as animated with Chrome's `ImageDecoder`.
- [x] Test pages (`testPages.ts`): index, `photo-01` to `photo-04` with every mutation, `animated`, `alpha` (checkerboard). Deployed with `BucketDeployment` to `/assets/test/`.
- [x] Automated checks (`verify.ts`, 24 checks, all pass on the deployed sample) and screenshots (`screenshots.ts`, `Bun.WebView` with Chrome).
- [x] Fix found by the animated tests: animated WebP answered 422, now passed through (`format=animated-webp`), with unit tests.
- [x] Workflow `.github/workflows/image-optimizer-integration.yml`: deploy, check, screenshot artifact, `visual-review` job on the environment `image-optimizer-visual-review`, destroy.
- [ ] One-time setup by the maintainer: OIDC role and `AWS_INTEG_ROLE_ARN` secret, environment with required reviewers. Not done, needs account and repository admin rights.

## Future Work (out of scope)

- **Snap-to-bucket mode:** an edge or Lambda mode that rounds requested sizes up to the next boundary, so the number of cache entries and Lambda invocations per image is bounded as well. This changes output sizes (`w=250` returns 300 wide), so it needs to be opt-in. A Svelte `srcset` helper that only emits boundary widths gets the same benefit without a mode.
- **Signing:** HMAC signatures verified by the CloudFront Function (design in ADR-005 and in Key Design Decisions, key stored in the KeyValueStore only), required when the service accepts remote public image URLs, optional `expires` with no expiry by default, key rotation with multiple keys, backend signer helper exported from the package.
- **Remote sources:** `generateUrl({ publicUrl: "https://pbs.twimg.com/media/x.jpg", ... })` producing `https://yourdomain.com/assets/ext/https%3A%2F%2Fpbs.twimg.com%2Fmedia%2Fx.jpg?w=300&h=300&fit=max&s=...`. The image is downloaded, processed through the same pipeline and cached by CloudFront. Needs: signing (mandatory, unsigned requests rejected at the edge so the distribution is not an open proxy), a Node.js signer helper that takes an injected `getKey()` reading the KeyValueStore, an allow list of hosts, SSRF protection (block private and link-local addresses, limit redirects), size and time limits, and the path-encoding result of the Task 1 spike.
- **Presets:** named parameter sets for social networks (`og` 1200x630, `twitter` 1200x675, square avatars) configured in the construct and expanded in the edge function before canonicalization. Needs crop.
- **Crop, pad, blur:** `fit=crop` with the `crop` position parameter, `min`, `fill`, `fillmax`, `blur`. Needs either Bun support or raw-pixel processing. Geometry already computes target sizes so crop and pad rectangles can be added.
- **Background colour and padding:** a `bg` parameter (imgix name) for two cases. (1) Flatten transparent images onto a colour before JPEG encoding; today transparent pixels show the RGB stored under them, usually black. (2) Pad to the requested box without upscaling: a 300x300 source with `w=500&h=500` returns a 500x500 image with the source unscaled on a `bg` canvas, placed by an anchor parameter (imgix uses `fit=fill` with `fill=solid&fill-color`, and `crop` positions such as `top,left`). `Bun.Image` 1.4.5 has no crop, extend, composite, flatten or raw-pixel access (checked with `Object.getOwnPropertyNames(Bun.Image.prototype)` on Bun 1.4.5 and in the type definitions), so both cases need the native module from ADR-007.
- **Animated GIF and WebP:** processing with animation support. Decided in ADR-007: a custom Rust N-API module with GIF and animated WebP output, built only for `aarch64-unknown-linux-gnu`. Size measured with a working prototype (macOS arm64 build of a Rust N-API module, `gif`, `fast_image_resize`, optional `webp-animation`): 0.57 MB (0.23 MB gzip) for GIF only, 1.06 MB (0.50 MB gzip) with animated WebP output, against 19.8 MB (8.5 MB zipped) for sharp with libvips on linux-arm64. Research (2026-11-26, versions and licenses from crates.io and npm): `Bun.Image` decodes only the first GIF frame, so animation needs a separate native module. Candidate stack, all MIT or MIT/Apache: Rust `gif` 0.14.2 (decode and encode, delays, disposal, transparency, loop count), `fast_image_resize` 6.2.0 (SIMD resize per frame), `color_quant` 2.0.0 or `quantette` 0.6.0 (palette quantization for GIF output), `webp-animation` 0.10.0 over `libwebp-sys` 0.14.4 (animated WebP output, usually far smaller than GIF), `napi` 3.16.3 with `@napi-rs/cli` 3.11.1 for prebuilt `.node` binaries. Avoid `gifski` (AGPL-3.0) and `imagequant`/libimagequant (GPL-3.0). Off-the-shelf alternative: `sharp` 0.35.5 (Apache-2.0, libvips) resizes animated GIF and WebP and has linux-arm64 builds, at the cost of a much larger deployment. What the image optimizer needs from such a module: composited full frames (disposal and transparency applied) rather than raw frame rectangles, a whole-pipeline call (decode, resize every frame, encode) so frames never cross the JavaScript boundary, animated WebP and GIF output with delays and loop count kept, limits checked from the header before decoding (frames x width x height, frame count, total duration), sub-20 ms delays kept as written (browsers clamp them), first-frame placeholder and `fm=jpg|png` support, and an aarch64-unknown-linux-gnu binary (glibc of Amazon Linux 2023) shipped next to `dist/handler/handler.js`. Unverified: N-API addon loading on the Bun Lambda runtime, `Bun.Image` behavior on animated WebP input.
- **Additional formats:** AVIF output when `Bun.Image` supports it on Linux.
- **Placeholder variants:** CSS-only LQIP, and a client helper that inlines placeholders at build or SSR time.
- **Svelte `srcset` helper:** generates `srcset` and `sizes` using boundary widths and the placeholder.
- **Rate limiting:** WAF rate rules and a per-image cap on distinct variants.
- **Intermediate lifecycle by access:** the lifecycle rule counts from creation. Tracking access (for example S3 Intelligent-Tiering or touching objects) would keep hot intermediates longer.
- **Non-image optimization:** JavaScript and CSS minification through the same dispatch (the handler dispatches on the sniffed content type, so another processor can be added). Probably a build-time concern, so deferred until there is a need.
