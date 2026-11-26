# ADR-003: Size Buckets and Persisted Intermediates

## Status

Accepted

## Context

Signing is deferred (ADR-005), so anyone can request `w=201`, `w=202`, `w=203`, and so on for one large original. Every request is a CloudFront cache miss and a full decode of the original, which exhausts Lambda time and memory.

## Decision

Define a fixed set of size boundaries on the longest edge (default 500, 1000, 1500, 2000, 2500, 3000). When a request needs a size between two boundaries, the Lambda first creates a uniformly downscaled copy of the original at the next boundary above the requested size, persists it in a separate private S3 bucket with an expiration lifecycle rule (default 180 days), and produces the requested size from that intermediate.

Rules:

- `requiredScale = max(finalWidth / sourceWidth, finalHeight / sourceHeight)`, using the final resized dimensions from the geometry (after `dpr`, `fit` and `rot`). Using both axes keeps `fit=scale` (skew) correct.
- The intermediate for boundary `B` is the source (EXIF orientation applied, metadata stripped) uniformly scaled so its longest edge is `B`. It is independent of `fit`, `w`, `h`, `rot` and `flip`.
- Choose the smallest `B` whose scale is at least `requiredScale` and where `B * minSourceToBucketRatio <= max(sourceWidth, sourceHeight)`. Otherwise use the original. `minSourceToBucketRatio` defaults to 1.5.
- The final image is always derived from the intermediate, also on the first miss, so output bytes do not depend on whether the intermediate existed.
- Intermediate key: `v1/{sourceKey}/{sourceEtag}/{B}`. Overwriting the original changes the ETag, so stale intermediates become unreachable and the lifecycle rule removes them.
- Concurrent first requests can write the same deterministic key. The content is identical, so this is safe.
- Encoding of the intermediate: lossy WebP at quality 95 (measurements below).

## Rationale

### 1. Bounds the cost of each invocation

The decode of the full original happens at most once per boundary per source version. Every other request decodes a small image.

Measured on the deployed Bun runtime (arm64, 1024 MB, ADR-004): a 12 MP PNG or WebP takes about 470 ms and 125 MB of memory to produce a 300 px thumbnail from the original, and 42 ms from a 1000 px intermediate, so intermediates make these sources about 10x cheaper. A 24 MP JPEG already decodes at a reduced size (120 ms and 42 MB to 300 px), so the intermediate saves about 3x. The benefit is largest for PNG and WebP sources.

### 2. What it does not do

It does not reduce the number of CloudFront cache entries or Lambda invocations. Every distinct `w` is still its own cache key. A mode that snaps requested sizes to boundaries is listed as future work.

### 3. Intermediate encoding, measured

Spike: a synthetic 3000x2000 image (gradient, stripes and noise, deliberately hard to compress) saved as JPEG quality 92 (1,666,332 bytes). A 1000x667 intermediate was produced in each encoding and a 750x500 final was derived from it. Mean absolute pixel difference is measured on 8-bit RGB values against a final produced directly from the original. The row for PNG is the floor caused by resampling twice.

| Intermediate  | Intermediate bytes | Mean abs diff vs direct (0-255) | Final WebP q80 bytes |
| ------------- | -----------------: | ------------------------------: | -------------------: |
| direct        |                  - |                               0 |               13,528 |
| WebP lossless |            781,870 |                           0.599 |               13,458 |
| PNG           |          1,077,770 |                           0.599 |               13,458 |
| WebP q100     |            180,478 |                           1.024 |               13,434 |
| WebP q95      |             85,084 |                           1.171 |               13,446 |
| WebP q90      |             35,612 |                           1.263 |               13,442 |
| JPEG q95      |            139,464 |                           1.302 |               13,532 |

Comparison with sharp (libvips): sharp defaults to WebP quality 80 and effort 4, offers `nearLossless`, `smartSubsample` and `alphaQuality`, strips all metadata and converts to sRGB. `Bun.Image` exposes only `quality` and `lossless` for WebP, preserves the ICC profile and strips EXIF (verified for JPEG, WebP and PNG output). The extra libvips tuning options are therefore not available, and `nearLossless` is the closest sharp feature to a "high quality but smaller than lossless" intermediate. The measurement above stands in for it. The `q` default stays 75, the imgix default, not sharp's 80.

Second measurement on nine real photographs (`packages/samples/imageOptimizer/scripts/compareIntermediates.ts` with the photos in `packages/samples/imageOptimizer/photos/`, 2048 to 5712 px wide JPEGs, `Bun.Image.backend = "bun"`, final WebP q75): output made through an intermediate has the same or slightly higher mean absolute difference than a direct resize at most sizes. At a few ratios (for example 600 px from a 1000 px intermediate, 1400 px from 1500 px) the difference to a lossless direct resize is larger, and the lossless intermediate shows it as well, so it comes from the second resampling step and not from the WebP quality. Visual inspection of the outputs by the maintainer found no visible difference at any tested size. Quality is therefore not a reason to skip intermediates for JPEG sources.

Choice: lossy WebP at quality 95. The generation loss above the resampling floor is about 0.57 on a 255 scale. Lossless is about nine times larger for the same final output. Real photographs compress better than this noise-heavy fixture, so the stored sizes are an upper bound. WebP also keeps an alpha channel, so PNG sources with transparency stay correct.

## Consequences

- One extra S3 bucket and one extra S3 write on the first request per boundary.
- Output pixels differ slightly from a direct resize of the original (two resampling steps). The difference is below the visible threshold in the measurement above.
- Lifecycle counts from creation, not access. Expired intermediates are regenerated on the next miss.
- Additional fixed cost: a ranged read for every request to obtain the ETag and header.

## Alternatives Considered

### Snap requested sizes to boundaries

Rejected for v1. It would bound the cache entries as well, but it changes the output size (`w=250` returns 300 wide) and has to be opt-in. Listed as future work.

### Reject unusual widths

Rejected. It contradicts the goal that changing URL parameters just works.

### WAF rate limiting only

Rejected as the only protection. It limits request rate but not the cost of each request. It remains a possible addition.

### Lossless intermediates

Rejected. About nine times larger than lossy q95 in the measurement for a small gain in fidelity.
