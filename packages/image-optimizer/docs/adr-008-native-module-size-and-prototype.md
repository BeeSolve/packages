# ADR-008: Native module size budget and prototype

## Status

Accepted

## Context

ADR-007 decides on a custom Rust N-API module for animated GIF and WebP. Two further features need raw pixels, which `Bun.Image` 1.4.5 neither returns nor accepts (its methods are `resize`, `rotate`, `flip`, `flop`, `modulate` and the encoders):

- `bg`: flatten transparent images onto a colour before JPEG encoding (today transparent pixels show the RGB stored under them, usually black).
- Padding: a 300x300 source requested as `w=500&h=500` without upscaling returns a 500x500 image with the source unscaled on a `bg` canvas, placed by an anchor (for example top-right).

The question was how much each feature adds to the module, and which format carries still images between `Bun.Image` and the module.

## Decision

- Keep the module in one crate with Cargo features, and ship the build with GIF, animated WebP, pad, anchor and flatten.
- Stills reach the module as lossless WebP produced by `Bun.Image`. The module decodes and encodes them with the libwebp that animated WebP output already links. `Bun.Image` does the final encode (JPEG, PNG, WebP, quality).
- Budget: about 1.1 MB unpacked and 0.5 MB gzip for the `aarch64-unknown-linux-gnu` binary.

## Rationale

### 1. Measured sizes

Prototype built on macOS arm64 (`cargo build --release`, LTO, `codegen-units = 1`, `panic = "abort"`, `strip -x`). Linux arm64 sizes have not been measured, and they are expected to be close because the code and libraries are the same.

| Build (Cargo features)                                | Size     | gzip   | Added            |
| ----------------------------------------------------- | -------- | ------ | ---------------- |
| GIF only                                              | 570 KB   | 233 KB |                  |
| GIF + animated WebP (`webp`)                          | 1,068 KB | 501 KB | +498 KB          |
| GIF + animated WebP + pad, WebP transport (`padwebp`) | 1,084 KB | 504 KB | +17 KB (+3 KB)   |
| GIF + animated WebP + pad, PNG transport              | 1,217 KB | 589 KB | +149 KB (+88 KB) |
| GIF + pad, PNG transport, no WebP (`padpng`)          | 702 KB   | 321 KB | +132 KB (+88 KB) |

For comparison, `sharp` 0.35.5 for linux-arm64 is 19.8 MB unpacked and 8.5 MB zipped (libvips alone is 18.3 MB).

### 2. The transport format decides the cost, not the operation

The pad, anchor and flatten loop is a few hundred bytes of machine code. The cost is in the codec that moves pixels across the boundary. libwebp is already linked for animated WebP output, so lossless WebP transport is almost free, while PNG transport adds the `png` crate and its deflate implementation.

### 3. Verified behavior

A 300x300 transparent PNG, resized by `Bun.Image` to lossless WebP, padded by the module to 500x500 on black with anchor top-right and encoded to JPEG by `Bun.Image`, came out 500x500 with the source in the top-right corner and transparency flattened onto black. The pad call took 7 ms.

## Consequences

- One extra lossless WebP encode and decode per padded or flattened still. Lossless WebP keeps the pixels exact, so quality is not affected, only CPU time.
- The module must reject inputs over the pixel limit before allocating the canvas, like the rest of the pipeline.
- Anchor values map to imgix-style positions (`top`, `bottom`, `left`, `right`, `center` and combinations) as fractions 0, 0.5 and 1 on each axis.

## Alternatives Considered

### PNG transport

Works without animated WebP support, but adds 149 KB (88 KB gzip) on top of a build that already links libwebp.

### Raw RGBA through an uncompressed container in JavaScript

`Bun.Image` decodes BMP, so JavaScript could inflate a PNG with `node:zlib`, pad it and hand a BMP back. No native code, but every pixel is filtered and copied in JavaScript, and BMP alpha support in `Bun.Image` is unverified.

### sharp

Covers all of it at about 20 MB (ADR-007).

## References

Prototype source. The bundle size numbers above come from these files.

`Cargo.toml`:

```toml
[package]
name = "gifmod"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[features]
webp = ["dep:webp-animation"]
pad = []
padpng = ["pad", "dep:png"]
padwebp = ["pad", "webp", "dep:libwebp-sys2"]

[dependencies]
napi = { version = "3", default-features = false, features = ["napi4"] }
napi-derive = "3"
gif = "0.14"
fast_image_resize = { version = "6", default-features = false, features = ["std"] }
webp-animation = { version = "0.10", optional = true }
png = { version = "0.18", optional = true }
libwebp-sys2 = { version = "0.2", optional = true }

[build-dependencies]
napi-build = "2"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
```

`src/lib.rs`, animation pipeline (decode with disposal applied, resize every frame, encode GIF or animated WebP):

```rust
use fast_image_resize::{images::Image, PixelType, Resizer};
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct Options {
    pub width: u32,
    pub height: u32,
    pub webp: bool,
    pub quality: u8,
}

struct Frame {
    rgba: Vec<u8>,
    delay_ms: u32,
}

#[napi]
pub fn transform(input: Buffer, options: Options) -> Result<Buffer> {
    let (width, height, frames, repeat) = decode(&input).map_err(Error::from_reason)?;
    let resized: Vec<Frame> = frames
        .into_iter()
        .map(|frame| resize(frame, width, height, options.width, options.height))
        .collect::<std::result::Result<_, String>>()
        .map_err(Error::from_reason)?;
    let bytes = encode(&resized, &options, repeat).map_err(Error::from_reason)?;
    Ok(bytes.into())
}

fn decode(input: &[u8]) -> std::result::Result<(u32, u32, Vec<Frame>, gif::Repeat), String> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options.read_info(input).map_err(|e| e.to_string())?;
    let width = decoder.width() as u32;
    let height = decoder.height() as u32;
    let mut canvas = vec![0u8; (width * height * 4) as usize];
    let mut frames = Vec::new();
    while let Some(frame) = decoder.read_next_frame().map_err(|e| e.to_string())? {
        let previous = canvas.clone();
        for y in 0..frame.height as u32 {
            for x in 0..frame.width as u32 {
                let source = ((y * frame.width as u32 + x) * 4) as usize;
                if frame.buffer[source + 3] == 0 {
                    continue;
                }
                let target_x = x + frame.left as u32;
                let target_y = y + frame.top as u32;
                if target_x >= width || target_y >= height {
                    continue;
                }
                let target = ((target_y * width + target_x) * 4) as usize;
                canvas[target..target + 4].copy_from_slice(&frame.buffer[source..source + 4]);
            }
        }
        frames.push(Frame { rgba: canvas.clone(), delay_ms: frame.delay as u32 * 10 });
        match frame.dispose {
            gif::DisposalMethod::Background => canvas.iter_mut().for_each(|value| *value = 0),
            gif::DisposalMethod::Previous => canvas = previous,
            _ => {}
        }
    }
    Ok((width, height, frames, decoder.repeat()))
}

fn resize(frame: Frame, width: u32, height: u32, target_width: u32, target_height: u32) -> std::result::Result<Frame, String> {
    let source = Image::from_vec_u8(width, height, frame.rgba, PixelType::U8x4).map_err(|e| e.to_string())?;
    let mut target = Image::new(target_width, target_height, PixelType::U8x4);
    Resizer::new().resize(&source, &mut target, None).map_err(|e| e.to_string())?;
    Ok(Frame { rgba: target.into_vec(), delay_ms: frame.delay_ms })
}

fn encode(frames: &[Frame], options: &Options, repeat: gif::Repeat) -> std::result::Result<Vec<u8>, String> {
    #[cfg(feature = "webp")]
    if options.webp {
        return encode_webp(frames, options);
    }
    encode_gif(frames, options, repeat)
}

fn encode_gif(frames: &[Frame], options: &Options, repeat: gif::Repeat) -> std::result::Result<Vec<u8>, String> {
    let mut output = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut output, options.width as u16, options.height as u16, &[]).map_err(|e| e.to_string())?;
        encoder.set_repeat(repeat).map_err(|e| e.to_string())?;
        for frame in frames {
            let mut rgba = frame.rgba.clone();
            let mut gif_frame = gif::Frame::from_rgba_speed(options.width as u16, options.height as u16, &mut rgba, 10);
            gif_frame.delay = (frame.delay_ms / 10) as u16;
            encoder.write_frame(&gif_frame).map_err(|e| e.to_string())?;
        }
    }
    Ok(output)
}

#[cfg(feature = "webp")]
fn encode_webp(frames: &[Frame], options: &Options) -> std::result::Result<Vec<u8>, String> {
    use webp_animation::{Encoder, EncoderOptions, EncodingConfig, EncodingType, LossyEncodingConfig};
    let config = EncodingConfig {
        quality: options.quality as f32,
        encoding_type: EncodingType::Lossy(LossyEncodingConfig::default()),
        ..Default::default()
    };
    let mut encoder = Encoder::new_with_options(
        (options.width, options.height),
        EncoderOptions { encoding_config: Some(config), ..Default::default() },
    )
    .map_err(|e| format!("{e:?}"))?;
    let mut timestamp = 0i32;
    for frame in frames {
        encoder.add_frame(&frame.rgba, timestamp).map_err(|e| format!("{e:?}"))?;
        timestamp += frame.delay_ms as i32;
    }
    let data = encoder.finalize(timestamp).map_err(|e| format!("{e:?}"))?;
    Ok(data.to_vec())
}
```

`src/lib.rs`, pad, anchor and flatten with lossless WebP transport:

```rust
#[cfg(feature = "pad")]
#[napi(object)]
pub struct PadOptions {
    pub width: u32,
    pub height: u32,
    pub background: u32,
    pub anchor_x: f64,
    pub anchor_y: f64,
}

#[cfg(feature = "pad")]
fn pad_rgba(rgba: &[u8], width: u32, height: u32, options: &PadOptions) -> Vec<u8> {
    let bg = options.background.to_be_bytes();
    let mut out = Vec::with_capacity((options.width * options.height * 4) as usize);
    for _ in 0..options.width * options.height {
        out.extend_from_slice(&bg);
    }
    let offset_x = ((options.width.saturating_sub(width)) as f64 * options.anchor_x).round() as u32;
    let offset_y = ((options.height.saturating_sub(height)) as f64 * options.anchor_y).round() as u32;
    for y in 0..height.min(options.height) {
        for x in 0..width.min(options.width) {
            let source = ((y * width + x) * 4) as usize;
            let target = (((y + offset_y) * options.width + x + offset_x) * 4) as usize;
            let alpha = rgba[source + 3] as u32;
            for channel in 0..3 {
                out[target + channel] = ((rgba[source + channel] as u32 * alpha
                    + out[target + channel] as u32 * (255 - alpha))
                    / 255) as u8;
            }
            out[target + 3] = (alpha + out[target + 3] as u32 * (255 - alpha) / 255) as u8;
        }
    }
    out
}

#[cfg(feature = "padwebp")]
#[napi]
pub fn pad(input: Buffer, options: PadOptions) -> Result<Buffer> {
    use libwebp_sys::*;
    unsafe {
        let mut width = 0;
        let mut height = 0;
        let decoded = WebPDecodeRGBA(input.as_ptr(), input.len(), &mut width, &mut height);
        if decoded.is_null() {
            return Err(Error::from_reason("decode failed"));
        }
        let rgba = std::slice::from_raw_parts(decoded, (width * height * 4) as usize).to_vec();
        WebPFree(decoded as *mut _);
        let out = pad_rgba(&rgba, width as u32, height as u32, &options);
        let mut encoded: *mut u8 = std::ptr::null_mut();
        let size = WebPEncodeLosslessRGBA(
            out.as_ptr(),
            options.width as i32,
            options.height as i32,
            (options.width * 4) as i32,
            &mut encoded,
        );
        if size == 0 {
            return Err(Error::from_reason("encode failed"));
        }
        let bytes = std::slice::from_raw_parts(encoded, size).to_vec();
        WebPFree(encoded as *mut _);
        Ok(bytes.into())
    }
}
```

Use from the Lambda (Bun):

```ts
const native = require("./imageNative.node");

const lossless = await new Bun.Image(original)
  .resize(300, 300, { fit: "inside", withoutEnlargement: true })
  .webp({ lossless: true })
  .bytes();
const padded = native.pad(Buffer.from(lossless), {
  width: 500,
  height: 500,
  background: 0x000000ff,
  anchorX: 1,
  anchorY: 0,
});
const jpeg = await new Bun.Image(padded).jpeg({ quality: 75 }).bytes();
```

Build and measure:

```sh
cargo build --release --features padwebp
cp target/release/libgifmod.dylib gifmod.node
strip -x gifmod.node
stat -f %z gifmod.node && gzip -9c gifmod.node | wc -c
```
