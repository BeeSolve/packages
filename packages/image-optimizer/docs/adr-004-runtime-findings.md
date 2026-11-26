# ADR-004: Runtime Findings (Bun CMR, CloudFront, S3)

## Status

Accepted

## Context

The design depends on behavior of the Bun customer-managed runtime (CMR), `Bun.s3`, `Bun.Image`, CloudFront and CloudFront Functions that cannot be known from documentation alone. A throwaway stack was deployed to `eu-central-1` with `@beesolve/lambda-bun-runtime` 4.10405.0 and destroyed afterwards. Local probes used Bun 1.4.4 on macOS with `Bun.Image.backend = "bun"`.

## Decision

Build on the findings below. Each finding states where it was measured.

### Bun Lambda (deployed)

- The default runtime alias `1.4` ran **Bun 1.4.5** on `linux/arm64`, not 1.4.4. The behaviors probed locally on 1.4.4 held.
- Lambda session credentials are picked up by `new S3Client({ bucket })` from `bun` (`AWS_ACCESS_KEY_ID` and `AWS_SESSION_TOKEN` present, `AWS_REGION` set).
- `file.stat()` returns `size`, `etag` (with surrounding quotes, for example `"60f05b50..."`), `lastModified` and `type`.
- `file.slice(0, 4096).arrayBuffer()` is a ranged read and `new Bun.Image(bytes).metadata()` on it returned width, height and format. Warm latency was 12 ms for `stat()` and 17 ms for the ranged read, cold 60 ms and 133 ms.
- A missing key rejects with `code: "NoSuchKey"` from both `stat()` and a ranged read.
- WebP lossy and lossless encoding work on arm64 Linux. AVIF rejects with `ERR_IMAGE_FORMAT_UNSUPPORTED`.
- `maxPixels` rejects with `ERR_IMAGE_TOO_MANY_PIXELS` from `metadata()` as well as from a resize, before any pixel buffer is allocated.
- Passthrough of a 959 KB JPEG through a buffered Function URL and CloudFront was byte-identical.

### Response streaming (deployed)

- The `awslambda` global does not exist on the Bun runtime. `asResponseStreamHandler` from `@beesolve/lambda-fetch-api` fails with `ReferenceError: awslambda is not defined`.
- A plain `ReadableStream` or async generator streams correctly through a `RESPONSE_STREAM` Function URL (chunks arrived 300 ms apart), but with status 200 and `Content-Type: application/octet-stream`.
- The Function URL ignores a manually written metadata prelude (JSON, eight zero bytes, body). The runtime posts streamed responses without `Content-Type: application/vnd.awslambda.http-integration-response`, so the prelude is delivered as body bytes. A streamed response therefore cannot set a status code or headers.
- Consequence for 4.10405.0: the handler would have to use the buffered `asHttpV2Handler` and `InvokeMode.BUFFERED` (6 MB response limit). Superseded by 4.10405.1, see the update below.

Update, verified on the deployed sample (`SamplesImageOptimizer`, runtime 4.10405.1, alias `1.4`): the runtime now defines the `awslambda` global, `asResponseStreamHandler` works with `InvokeMode.RESPONSE_STREAM` behind CloudFront with OAC, and status codes (200, 400, 404) and headers (`Content-Type`, `Cache-Control`, `Vary`, `X-Image-Optimizer`) reach the viewer. The findings above describe 4.10405.0.

### Function URL protection (deployed)

- A Function URL with `AuthType AWS_IAM` behind CloudFront with origin access control (`FunctionUrlOrigin.withOriginAccessControl`) worked with the buffered invoke mode. The distribution forwarded the viewer query string and viewer headers to the Bun function. See ADR-006 for the decision.
- OAC combined with streaming was not tested because streaming cannot set status or headers.

### Decode cost and memory (deployed, 1024 MB, arm64)

| Source                         | Operation                      |     Time | Peak RSS |
| ------------------------------ | ------------------------------ | -------: | -------: |
| JPEG 6000x4000 (24 MP, 3.8 MB) | full to 300 px WebP            |   120 ms |    42 MB |
| JPEG 6000x4000                 | full to 1000 px WebP           |   282 ms |    51 MB |
| JPEG 6000x4000                 | full to 3000 px WebP           | 1,244 ms |    77 MB |
| JPEG 6000x4000                 | no resize, WebP                | 5,601 ms |   179 MB |
| PNG 4000x3000 (12 MP, 34 MB)   | full to 300 px WebP            |   466 ms |   124 MB |
| PNG 4000x3000                  | full to 3000 px WebP           | 1,587 ms |   103 MB |
| WebP 4000x3000 (12 MP, 2 MB)   | full to 300 px WebP            |   486 ms |   127 MB |
| any                            | 1000 px intermediate to 300 px |    42 ms | 55-83 MB |

- JPEG decoding already scales during decode (24 MP to 300 px in 120 ms and 42 MB), so intermediates save little for JPEG sources, about 3x at small sizes. PNG and WebP sources decode fully, so an intermediate is about 10x cheaper for small outputs. See ADR-003.
- The expensive requests are large outputs and unresized re-encodes. `maxPixels` and the output size limit (8192) bound them.

### CloudFront and CloudFront Functions (deployed)

- A CloudFront Function cannot add headers starting with `x-edge-`. The distribution returns 502 "The CloudFront function tried to add a disallowed header". Custom headers must use another prefix.
- `request.uri` keeps percent-encoding: `%3A`, `%2F`, `%20`, `%2B` and `%252F` arrived unchanged at the function and, through CloudFront, at the Lambda (`rawPath`). `//` is not collapsed. Plain `https://` in the path also arrives unchanged.
- `request.querystring` preserves key case and order of arrival. For duplicated keys, `value` holds the **first** value and `multiValue` lists all values in order. Taking the last value (as the canonicalization rule requires) means reading `multiValue`.
- A CloudFront Function (runtime `cloudfront-js-2.0`) can `require("crypto")`, call `createHmac("sha256", key)` and read a KeyValueStore with `cf.kvs().get(key)`. `aws cloudfront test-function` reported compute utilization 8 (out of 100) for one KeyValueStore read plus one HMAC.
- The JavaScript runtime 2.0 documentation lists `const`, `let`, arrow functions, template literals, rest parameters, `async` and the ES5.1 statements (`for`, `for-in`, no `for...of`). Spread, destructuring, shorthand properties, default parameters, optional catch binding, `?.` and `??` are not listed. The function is built with esbuild, which lowers the lowerable ones and fails the build for `for...of` and destructuring. The built function (7.4 KB, `const`, arrow functions and template literals) was accepted by CloudFront and runs in the deployed sample.
- A function may assign `request.querystring` a plain string (`'a=1&b=2'`) instead of an object, which also fixes the parameter order. The image function writes the canonical query that way.
- Function size limit: 10 KB (AWS quota, not adjustable). The spike function was 501 bytes. `query.ts` and `accept.ts` plus the handler must stay below 10 KB after bundling.
- Cache policy quotas: 10 query strings, 10 headers, combined name length 1024. The 9 supported keys and the `Accept` header fit.

### Image sample (deployed)

- CloudFront passes query values to the function percent-encoded (`w=1%301` arrives encoded and is decoded to `w=101` by `canonicalizeQuery`).
- CloudFront normalizes `%2e%2e` in the path before it matches cache behaviors, so `/assets/%2e%2e/secret.jpg` is routed as `/secret.jpg` and never reaches the image function.
- On real S3, the image function on 2048 MB used at most 155 MB, the init duration was 98 to 106 ms, and a full-size WebP re-encode of a 12 MP photo took 1.8 s. Resizes from a 500 px intermediate took 160 to 200 ms end to end through CloudFront on a miss, a cache hit 68 ms.

### Animations and transparency (deployed and local, Bun 1.4.4 and 1.4.5)

- `Bun.Image#metadata()` succeeds on an animated WebP and reports `format: "webp"`, but decoding fails with `ERR_IMAGE_DECODE_FAILED`. The pipeline therefore checks the `VP8X` animation flag of the header itself and passes animated WebP through unchanged (`format=animated-webp`). Without that check every animated WebP answered 422.
- `Bun.Image` decodes the first frame of a GIF.
- `Bun.Image` keeps the alpha channel for PNG and WebP output (verified with full and half-transparent pixels after resize and rotation). JPEG output drops alpha without compositing, so transparent pixels show the RGB stored under them.
- `Bun.WebView` with the Chrome backend can load the test pages, evaluate scripts (for example `ImageDecoder` to count animation frames) and take full-page screenshots, which the integration workflow uses.

### Remote URL embedded in the path (deployed)

- `/assets/ext/https%3A%2F%2Fexample.com%2Fa.jpg` survives CloudFront, the CloudFront Function and the Function URL (`rawPath`) unchanged, with `%2F` and `%3A` still encoded. `//` is preserved. Nothing in v1 depends on this. If a future change breaks it, the fallbacks are a `?url=` query parameter or a base64url path segment.

### Sniff range for `metadata()` (local, Bun 1.4.4)

- A truncated JPEG header rejects with `ERR_IMAGE_DECODE_FAILED`. `metadata()` works once the range covers the header up to the frame marker. A plain JPEG worked from 1 KB. A JPEG with one 64 KB APP segment needed 128 KB, one with 256 KB of APP segments needed 256 KB.
- The ranged read starts at 16 KB. On `ERR_IMAGE_DECODE_FAILED` the Lambda retries with 128 KB and then 1 MB, capped by `maxSourceBytes`, and answers 422 afterwards. PNG and WebP headers are inside the first bytes.

## Rationale

These facts remove assumptions from the plan and change four decisions: buffered handler instead of streaming, ETag taken from `stat()`/the ranged read (works), the size-bucket cost model (ADR-003), and a `multiValue` rule in the edge function.

## Consequences

- The package depends on `@beesolve/lambda-fetch-api` for `asResponseStreamHandler` and on `@beesolve/lambda-bun-runtime` 4.10405.1 or newer.
- If the buffered fallback is needed, passthrough of non-images is limited to 6 MB. Larger non-image files are served from S3 by the extension-based behavior split and do not reach the Lambda.

## Alternatives Considered

### Buffered handler

Fallback only. It works on every runtime version tested but limits responses to 6 MB.

### Reading the whole object for the sniff

Rejected. It defeats the purpose of the ranged read for large originals.
