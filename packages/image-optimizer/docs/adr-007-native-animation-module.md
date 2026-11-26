# ADR-007: Custom native module for animated images

## Status

Accepted

## Context

`Bun.Image` decodes only the first frame of a GIF and cannot decode animated WebP. Animated GIF and WebP are therefore passed through unchanged (`X-Image-Optimizer: passthrough; reason=unsupported-format`). Resizing and converting animations needs a native module.

Two options were measured (2026-11-26):

- `sharp` 0.35.5 (libvips) for linux-arm64: 19.8 MB unpacked, 8.5 MB zipped. libvips alone is 18.3 MB.
- A prototype Rust N-API module (`gif` 0.14, `fast_image_resize` 6, `napi` 3, optional `webp-animation` 0.10): 0.57 MB (0.23 MB gzip) for GIF only, 1.06 MB (0.50 MB gzip) with animated WebP output.

`Bun.Image` already covers stills (resize, rotate, flip, JPEG, PNG and WebP output, placeholders), so most of sharp would go unused.

## Decision

Build a custom Rust N-API module for animated images with GIF and animated WebP output. Ship only `aarch64-unknown-linux-gnu` (glibc of Amazon Linux 2023): `BunFunction` from `@beesolve/lambda-bun-runtime` is arm64 only, and the module only runs in the Lambda.

The module lives inside `@beesolve/image-optimizer` and ships next to `dist/handler/handler.js`. It has no other consumer, and it can move to its own package if one appears.

The module exposes one whole-pipeline call (decode, composite frames, resize every frame, encode), so frames never cross the JavaScript boundary. It checks limits from the header (frame count, frames x width x height, total duration) before decoding. Stills keep using `Bun.Image`.

## Rationale

### 1. Size

About 1.06 MB against 19.8 MB. Deployment size affects cold starts, and the module only has to cover what `Bun.Image` cannot.

### 2. Scope

The image optimizer needs a small set of operations on animations. A whole-pipeline call keeps the JavaScript side small and avoids copying frames between Rust and JavaScript.

### 3. One platform

The Lambda is arm64 only, so one prebuilt binary is enough. There is no need for a per-platform optional dependency matrix.

### 4. Licenses

The candidate crates are MIT or MIT/Apache-2.0. `gifski` (AGPL-3.0) and `imagequant`/libimagequant (GPL-3.0) are excluded.

## Consequences

- A Rust toolchain and cross-compilation to `aarch64-unknown-linux-gnu` become part of the build, in CI and for releases.
- The binary cannot run on macOS developer machines. Local tests of the animation path need a Linux arm64 environment (container or CI), or the code path is skipped.
- N-API addon loading on the Bun Lambda runtime has not been verified yet and is the first thing to check.
- The module can also host raw-pixel operations that `Bun.Image` lacks (pad with a background colour and anchor, flatten transparency, crop). Measurements and the prototype code are in ADR-008.

## Alternatives Considered

### sharp

Covers animations and every planned raw-pixel operation, but adds 19.8 MB, and almost all of it duplicates `Bun.Image`.

### Keep passthrough

No build complexity, but animations are served at their original size and format.

### Linux x64 and macOS binaries

Not needed for the Lambda. They can be added later if the module is used outside it.
