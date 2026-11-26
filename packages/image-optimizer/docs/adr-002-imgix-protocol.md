# ADR-002: imgix Rendering API Subset as URL Protocol

## Status

Accepted

## Context

The service needs a URL protocol: the names, values and semantics of the parameters that describe a transformation. Inventing a protocol means documenting every parameter and its edge cases ourselves. Reusing an existing public API means the semantics are already documented and consumers may already know them.

`Bun.Image` 1.4.4 limits what can be implemented: `resize` accepts only `fill` and `inside`, there is no crop, pad or blur, and `rotate` accepts only multiples of 90.

## Decision

Use a documented subset of the [imgix Rendering API](https://docs.imgix.com/en-US/apis/rendering).

Supported parameters: `w`, `h`, `dpr`, `fit` (`clip`, `max`, `scale`), `q`, `fm` (`webp`, `jpg`, `png`), `rot` (multiples of 90), `flip` (`h`, `v`, `hv`). One own parameter: `placeholder=1`.

Known imgix parameters that are not supported (`crop`, `blur`, and `fit` values `crop`, `min`, `fill`, `fillmax`, `clamp`, `facearea`) return 400 instead of silently producing a different image. Unknown parameters, such as tracking parameters, are dropped by the edge function and never reach the cache key.

The README links to imgix for parameter semantics and documents only what is supported and where it differs.

## Rationale

### 1. Documented semantics

imgix documents every supported parameter, including how `fit`, `w`, `h` and `dpr` interact. Our documentation only has to list the subset and the differences.

### 2. Fail loudly on unsupported input

Ignoring `crop` would return an image with the wrong shape under a valid-looking URL, and CloudFront would cache it for a year. A 400 is visible immediately.

### 3. Room to grow

The subset leaves the unsupported names reserved. When crop and blur become possible, URLs that already work keep working.

## Consequences

- Consumers who know imgix can use the service without reading a new specification.
- Behavior that differs from imgix (rotation limited to multiples of 90, `placeholder`, `fm` limited to three values) must be documented as differences.
- A subset can be mistaken for the full API. The 400 response for unsupported parameters mitigates this.

## Alternatives Considered

### Sharp-style custom parameter names

Rejected. Sharp is a library and has no URL protocol, so every name and semantic would be ours to define and document.

### imgproxy, Thumbor, Cloudinary, IIIF

Rejected. imgproxy and Thumbor encode operations in the path or a signature-first format, which does not fit the `?query` cache key canonicalization done at the edge. Cloudinary uses path-based transformation strings tied to its service. IIIF is aimed at tiled image delivery for archives and has a rigid path structure. imgix uses plain query parameters, which map directly to a CloudFront cache key.

## References

- https://docs.imgix.com/en-US/apis/rendering
