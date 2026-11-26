# Image Optimizer

Resize and re-encode images stored in S3 by changing URL parameters, served and cached by CloudFront, for example `https://cdn.example.com/assets/photos/cat.jpg?w=400&fit=max`.

> [!WARNING]
> **Pre-1.0 - unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

The package contains a CDK construct (`@beesolve/image-optimizer/cdk`) and a URL builder for application code (`@beesolve/image-optimizer`). Images are processed by `Bun.Image` on a [Bun Lambda](https://github.com/BeeSolve/lambda-bun-runtime). The URL parameters are a subset of the [imgix Rendering API](https://docs.imgix.com/en-US/apis/rendering).

## Installation

```bash
bun add @beesolve/image-optimizer
```

(or `npm install @beesolve/image-optimizer`)

`aws-cdk-lib` (2.278.0 or newer) and `constructs` are peer dependencies. The stack needs a concrete region in which the Bun runtime is published: `eu-north-1`, `eu-central-1`, `eu-west-1`, `us-east-1` or `us-west-2`.

## Quick Start

```ts
import { createImageOptimizerDistribution, ImageOptimizer } from "@beesolve/image-optimizer/cdk";
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { Bucket } from "aws-cdk-lib/aws-s3";

const bucket = new Bucket(this, "Images");
const distribution = createImageOptimizerDistribution({ scope: this, id: "Distribution", bucket });

new ImageOptimizer(this, "ImageOptimizer", {
  bucket,
  distribution,
  keepActive: new LambdaKeepActive(this, "KeepActive"),
});
```

Upload `assets/photos/cat.jpg` to the bucket and request `https://{distribution.distributionDomainName}/assets/photos/cat.jpg?w=400`.

The distribution always comes from the caller. `createImageOptimizerDistribution` creates one whose default behavior answers 404 from a CloudFront Function, so only `/{assetsPathPrefix}/*` is served. Pass `distributionProps` for `domainNames`, `certificate`, `priceClass` and other settings. To use a distribution you already have, pass it instead: the construct only adds its behaviors and does not change the default behavior. The behaviors are appended, so behaviors you added earlier take precedence for overlapping path patterns.

## What Gets Created

- One behavior per image extension, in lowercase and uppercase (`jpg`, `jpeg`, `png`, `webp`), routed to the image function through a viewer-request CloudFront Function that canonicalizes the query string and normalizes `Accept`.
- A `/{assetsPathPrefix}/*` behavior that serves everything else under the prefix (PDF, GIF, SVG, ...) straight from the bucket.
- A Bun Lambda behind a Function URL (`AWS_IAM`, response streaming) protected by origin access control. It has read access to the source bucket only.
- A private bucket for intermediate copies with an expiration lifecycle rule.

## Construct Props

| Prop                        | Default                               | Description                                                                                       |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `bucket`                    | required                              | Bucket with the originals. The S3 key of `/assets/photos/cat.jpg` is `assets/photos/cat.jpg`      |
| `distribution`              | required                              | Distribution to add the behaviors to. Its default behavior is not changed                         |
| `assetsPathPrefix`          | `"assets"`                            | Path prefix the distribution serves                                                               |
| `cacheTtl`                  | `Duration.days(365)`                  | `Cache-Control` max-age and the CloudFront TTLs of processed images                               |
| `sizeBuckets`               | `[500, 1000, 1500, 2000, 2500, 3000]` | Longest edge of the intermediate copies, ascending and unique                                     |
| `intermediateRetentionDays` | `180`                                 | Days until intermediate copies expire                                                             |
| `maxSourceBytes`            | `52428800`                            | Larger originals are not processed (422)                                                          |
| `maxPixels`                 | `50000000`                            | Originals with more pixels are not processed (422)                                                |
| `minSourceToBucketRatio`    | `1.5`                                 | An intermediate is only created when the original is at least this many times larger              |
| `memorySize`                | `2048`                                | Lambda memory in MB                                                                               |
| `timeout`                   | `Duration.seconds(30)`                | Lambda timeout                                                                                    |
| `keepActive`                | none                                  | `LambdaKeepActive` from `@beesolve/lambda-keep-active`, keeps the function from becoming inactive |

The construct exposes `handler`, `intermediateBucket` and `edgeFunction`.

`createImageOptimizerDistribution({ scope, id, bucket, distributionProps? })` returns the `Distribution`. `distributionProps` takes every `DistributionProps` setting except `defaultBehavior`.

## URL Parameters

| Parameter     | Values                 | Default     | imgix reference                                                                                                                       |
| ------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `w`, `h`      | 1 to 8192              | source size | [w](https://docs.imgix.com/en-US/apis/rendering/size/image-width), [h](https://docs.imgix.com/en-US/apis/rendering/size/image-height) |
| `fit`         | `clip`, `max`, `scale` | `clip`      | [fit](https://docs.imgix.com/en-US/apis/rendering/size/resize-fit-mode)                                                               |
| `dpr`         | 1 to 3                 | 1           | [dpr](https://docs.imgix.com/en-US/apis/rendering/device-pixel-ratio)                                                                 |
| `q`           | 1 to 100               | 75          | [q](https://docs.imgix.com/en-US/apis/rendering/format/output-quality)                                                                |
| `fm`          | `webp`, `jpg`, `png`   | negotiated  | [fm](https://docs.imgix.com/en-US/apis/rendering/format/output-format)                                                                |
| `rot`         | 0, 90, 180, 270        | 0           | [rot](https://docs.imgix.com/en-US/apis/rendering/rotation/rotation)                                                                  |
| `flip`        | `h`, `v`, `hv`         | none        | [flip](https://docs.imgix.com/en-US/apis/rendering/rotation/flip-axis)                                                                |
| `placeholder` | `1`                    | none        | own parameter, see below                                                                                                              |

When only `w` or `h` is given, the other side follows the aspect ratio. `dpr` multiplies both.

For a 100x200 original requested with `w=300&h=300`:

| `fit`   | Result  | Meaning                                                  |
| ------- | ------- | -------------------------------------------------------- |
| `clip`  | 150x300 | fits inside the box, keeps the aspect ratio, may enlarge |
| `max`   | 100x200 | like `clip`, never enlarges                              |
| `scale` | 300x300 | stretches to the box                                     |

## Differences From imgix

- Only the parameters above are supported. Known imgix parameters that are not supported (`crop`, `blur`) and `fit` values `crop`, `min`, `fill`, `fillmax`, `clamp`, `facearea` return 400 instead of a different image.
- Unknown parameters, for example tracking parameters, are ignored and are not part of the cache key.
- `rot` accepts quarter turns only, clockwise.
- `fm` supports `webp`, `jpg` and `png`. AVIF and HEIC are not available on the Lambda.
- `placeholder=1` returns a tiny ThumbHash placeholder of the (resized, rotated) image as a `data:image/png;base64,...` URL with `Content-Type: text/plain`.
- Only still JPEG, PNG and WebP originals are processed. Animated WebP and other content under an image extension (for example a GIF stored as `.jpg`) is returned unchanged with `X-Image-Optimizer: passthrough; ...`.
- Transparency is kept for WebP and PNG output. JPEG has no alpha channel: converting a transparent image with `fm=jpg` shows the colour stored under the transparent pixels, usually black. There is no background colour parameter yet.
- EXIF metadata is removed. EXIF orientation is applied before any other operation.

## Output Format

Without `fm`, the response is WebP when the request's `Accept` header lists `image/webp`, and the original format otherwise. Browsers list it for `<img>`, `<picture>` and CSS requests. Opening an image URL in the address bar is a document request whose `Accept` does not list `image/webp`, so the original format is returned there. `*/*` alone does not select WebP.

## Response Headers

| Header                   | Value                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `Cache-Control`          | `public, max-age={cacheTtl}` on images, `no-store` on errors                              |
| `Vary`                   | `Accept`                                                                                  |
| `X-Content-Type-Options` | `nosniff`                                                                                 |
| `X-Image-Optimizer`      | `optimized`, `placeholder`, or `passthrough; reason=unsupported-format; format={sniffed}` |

`X-Image-Optimizer` is cached with the response. It is absent on errors and on files served from the bucket by the `/{assetsPathPrefix}/*` behavior, so its absence means the optimizer did not process the request.

## Status Codes

| Status | When                                                                 |
| ------ | -------------------------------------------------------------------- |
| 400    | Unsupported or invalid parameter, value out of range, path traversal |
| 404    | Missing object, path outside the assets prefix                       |
| 422    | Original over `maxSourceBytes` or `maxPixels`, or not decodable      |

## Caching

The CloudFront Function lowercases parameter names, drops unknown parameters and default values, keeps the last value of a duplicated parameter, normalizes numbers and sorts the parameters. `?h=200&w=100`, `?w=100&h=200` and `?W=0100&H=200&utm_source=x&fit=clip` share one cache entry. `Accept` is reduced to `image/webp` or `*/*`, so all browsers that accept WebP share one entry per URL.

## Size Buckets

Requesting many different widths of one large original (`w=201`, `w=202`, ...) would decode the full original for every request. To bound that cost the function first creates a uniformly downscaled copy of the original at the next size bucket above the requested size, stores it in the intermediate bucket, and produces the requested size from that copy. Later requests for any size up to the same bucket read the small copy, and the original is only read for its header. Copies are keyed by the original's ETag, so overwriting an original creates new copies. Expired copies are created again when needed.

## Building URLs

`generateUrl` from `@beesolve/image-optimizer` builds URLs in the canonical cache-key form. It has no dependencies and works in browsers, SvelteKit, Node.js and Bun.

```ts
import { generateUrl } from "@beesolve/image-optimizer";

const src = generateUrl({
  baseUrl: "https://cdn.example.com",
  assetsPathPrefix: "assets",
  path: "photos/cat.jpg",
  mutations: [
    { type: "fitBox", width: 400, height: 300, enlarge: false },
    { type: "pixelRatio", ratio: 2 },
    { type: "auto" },
  ],
});
// https://cdn.example.com/assets/photos/cat.jpg?dpr=2&fit=max&h=300&w=400
```

All four props are required, pass `mutations: []` for the unmodified original. Each mutation is one variant of the `Mutation` union, at most one per group, in any order:

| Group       | Mutations                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| size        | `fitBox` (`width`, `height`, `enlarge`), `fitWidth` (`width`, `enlarge`), `fitHeight` (`height`, `enlarge`), `stretch` (`width`, `height`) |
| pixel ratio | `pixelRatio` (`ratio` 1 to 3), needs a size mutation                                                                                       |
| rotation    | `rotate` (`degrees` 90, 180 or 270)                                                                                                        |
| flip        | `flip` (`direction` `horizontal`, `vertical` or `both`)                                                                                    |
| output      | `toWebp` (`quality?`), `toJpeg` (`quality?`), `toPng`, `auto` (`quality?`), `placeholder`                                                  |

`enlarge: false` maps to `fit=max`, `enlarge: true` to `fit=clip`, `stretch` to `fit=scale`. `quality` defaults to 75. Default values are not written into the URL. Invalid combinations fail to compile where the types can express them; two mutations of one group, a `pixelRatio` without a size, and out-of-range numbers throw an `Error` that names the mutation.

## Limits

- `w`, `h`: 1 to 8192, `dpr`: 1 to 3, `q`: 1 to 100
- Animated images are not resized or converted. Animated WebP is returned unchanged by the function, GIF is served from the bucket unchanged
- There is no URL signing. Anyone who knows the distribution can request any supported transformation of any object under the prefix

See [DOCS.md](./DOCS.md) for how-to guides.
