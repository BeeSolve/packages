# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Teams that keep images in S3 behind CloudFront want to change an image by changing URL parameters, for example `https://xyz.cloudfront.net/assets/photos/cat.jpg?w=400&fit=max`, without running a separate image service. The result has to be served in the best format the browser accepts (WebP, falling back to the original format) and cached by CloudFront.

The pieces needed for that are small individually, but they only work when they agree with each other:

- a CloudFront Function that canonicalizes the query string and normalizes `Accept`, so the cache key is stable
- a Lambda that reads the original from S3, transforms it and answers
- a CDK construct that wires S3, the Lambda, CloudFront behaviors and cache policies
- a URL builder for application code that produces URLs already in cache-key form

If the URL builder, the edge function and the Lambda each define their own idea of the supported parameters and limits, equivalent URLs end up with different cache entries, or the Lambda rejects URLs the builder produced.

Until now the image-processing Lambda was the expensive piece. On Node.js it needs `sharp` (libvips), about 20 MB for linux-arm64 (19.8 MB unpacked, 8.5 MB zipped), plus the AWS SDK S3 client. `@beesolve/lambda-bun-runtime` now runs Bun on Lambda as a customer-managed runtime (CMR) through `BunFunction`, without a layer. Bun has `Bun.Image` (decode, resize, rotate, flip, JPEG, PNG and WebP encoding, ThumbHash placeholders, with statically linked libjpeg-turbo, libspng and libwebp) and `Bun.s3` built in. The whole handler is a 23 KB bundle with no native dependencies, so the deployment package stays small, cold starts have nothing large to load, and no image library has to be built or kept up to date for Lambda.

## Decision

Ship one standalone package, `@beesolve/image-optimizer`, that owns all four pieces and shares one definition of the parameters (`limits.ts`, `query.ts`):

- `"."` exports `generateUrl`, a dependency-free helper for browsers, SvelteKit, Node.js and Bun. Later runtime helpers such as URL signing go here too. The CDK construct is the separate `"./cdk"` export, so runtime code never pulls in `aws-cdk-lib`.
- The canonicalization (`query.ts`) is shared internally by the edge function, the Lambda and `generateUrl`, but not exported.
- The Lambda handler and the edge function are build artifacts, not public exports.

The Lambda runs on the Bun CMR and uses `Bun.Image` and `Bun.s3` instead of `sharp` and the AWS SDK.

## Rationale

### 1. One contract, one package

The edge function, the Lambda and the URL helper must agree on the supported keys, default values, ranges and canonical form. Sharing the modules removes the possibility of drift.

### 2. Standalone instead of inline code

Every consumer would otherwise copy the same CloudFront Function, cache policy and Lambda wiring. A package makes the behavior testable and versioned once. The construct does not belong in `@beesolve/cdk-constructs`, because it carries a Lambda bundle and a runtime dependency on `@beesolve/lambda-bun-runtime`.

### 3. Bun on Lambda removes the image library

`Bun.Image` covers the still-image operations of v1 and `Bun.s3` covers reading originals and writing intermediates. Compared with a Node.js Lambda with `sharp`, there is no 20 MB native dependency to ship, no per-architecture build of libvips, and no SDK client to bundle. What `Bun.Image` lacks (animations, padding) is added later as a small native module (ADR-007, ADR-008) instead of a general image library.

### 4. Boundaries

In scope: reading images from one S3 bucket, a documented subset of the imgix Rendering API (ADR-002), bounded cost per request (ADR-003), a CDK construct, a URL builder.

Out of scope for v1: signed URLs (ADR-005), remote source URLs, crop, pad and blur, animated formats, AVIF output, presets for social networks.

## Consequences

- The package depends on `@beesolve/lambda-bun-runtime` and on `Bun.Image` and `Bun.s3` being available on the Bun Lambda runtime. Features are limited to what `Bun.Image` supports until the native module exists (ADR-002, ADR-007).
- `query.ts`, `accept.ts`, `limits.ts` and `url.ts` must stay free of runtime-specific imports because they run in a CloudFront Function and in browsers.
- Changing the canonical query form changes cache keys for every deployed distribution, so it is treated as a breaking change.

## Alternatives Considered

### Inline code in each application

Rejected. It duplicates the edge function and cache policy and invites the drift described above.

### Node.js Lambda with sharp

Rejected. About 20 MB of libvips for operations that `Bun.Image` already provides, and an S3 client from the AWS SDK.

### Hosted image service (Cloudinary, imgix)

Rejected for this package. The goal is to keep images in the owner's S3 bucket and CloudFront distribution without a third-party service.
