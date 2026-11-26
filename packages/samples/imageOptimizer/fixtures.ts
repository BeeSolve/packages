import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { applyPalette, GIFEncoder, quantize } from "gifenc";

export const fixturesDirectory = join(import.meta.dirname, "fixtures");

interface Size {
  width: number;
  height: number;
}

interface FrameProps extends Size {
  index: number;
  count: number;
}

if (import.meta.main) {
  Bun.Image.backend = "bun";
  await mkdir(fixturesDirectory, { recursive: true });
  const small = { width: 160, height: 120 };
  const large = { width: 640, height: 360 };

  await write("animated-small.gif", animatedGif({ ...small, count: 12 }));
  await write("animated-large.gif", animatedGif({ ...large, count: 24 }));
  await write("animated-small.webp", await animatedWebp({ ...small, count: 12 }));
  await write("animated-large.webp", await animatedWebp({ ...large, count: 24 }));
  await write("alpha.png", rgbaPng({ ...large, rgba: frame({ ...large, index: 3, count: 12 }) }));
  await write(
    "alpha.webp",
    await new Bun.Image(rgbaPng({ ...large, rgba: frame({ ...large, index: 3, count: 12 }) }))
      .webp({ quality: 90 })
      .bytes(),
  );
  await write("still.gif", animatedGif({ ...small, count: 1 }));
}

async function write(name: string, bytes: Uint8Array): Promise<void> {
  await Bun.write(join(fixturesDirectory, name), bytes);
  console.log(`${name} ${bytes.length} bytes`);
}

/**
 * A ball moving on a transparent background over a half-transparent stripe, so animation,
 * per-frame timing, full transparency and partial transparency are all visible.
 */
function frame(props: FrameProps): Uint8Array {
  const { width, height } = props;
  const rgba = new Uint8Array(width * height * 4);
  const radius = Math.round(height / 5);
  const centerX = Math.round(
    radius + ((width - 2 * radius) * props.index) / Math.max(1, props.count - 1),
  );
  const centerY = Math.round(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (y > height * 0.75) {
        rgba.set([40, 90, 200, 128], offset);
      }
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        rgba.set([230, 70 + Math.round((150 * x) / width), 40, 255], offset);
      }
    }
  }
  return rgba;
}

interface AnimationProps extends Size {
  count: number;
}

function animatedGif(props: AnimationProps): Uint8Array {
  const encoder = GIFEncoder();
  for (let index = 0; index < props.count; index++) {
    const rgba = frame({ ...props, index });
    const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    encoder.writeFrame(applyPalette(rgba, palette, "rgba4444"), props.width, props.height, {
      palette,
      delay: 80,
      repeat: 0,
      transparent: transparentIndex !== -1,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    });
  }
  encoder.finish();
  return encoder.bytes();
}

/**
 * Builds an animated WebP container from still frames encoded by `Bun.Image`, which cannot
 * write animations itself. Each frame keeps its `ALPH` and `VP8 `/`VP8L` chunks inside an
 * `ANMF` chunk.
 */
async function animatedWebp(props: AnimationProps): Promise<Uint8Array> {
  const frames: Array<Uint8Array> = [];
  for (let index = 0; index < props.count; index++) {
    const still = await new Bun.Image(rgbaPng({ ...props, rgba: frame({ ...props, index }) }))
      .webp({ quality: 80 })
      .bytes();
    frames.push(
      riffChunk(
        "ANMF",
        concat([
          uint24(0),
          uint24(0),
          uint24(props.width - 1),
          uint24(props.height - 1),
          uint24(80),
          new Uint8Array([0b10]),
          ...imageChunks(still),
        ]),
      ),
    );
  }
  const header = concat([
    new Uint8Array([0x12, 0, 0, 0]),
    uint24(props.width - 1),
    uint24(props.height - 1),
  ]);
  const body = concat([
    new TextEncoder().encode("WEBP"),
    riffChunk("VP8X", header),
    riffChunk("ANIM", new Uint8Array([0, 0, 0, 0, 0, 0])),
    ...frames,
  ]);
  return concat([new TextEncoder().encode("RIFF"), uint32(body.length), body]);
}

function imageChunks(webp: Uint8Array): Array<Uint8Array> {
  const chunks: Array<Uint8Array> = [];
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const type = String.fromCharCode(...webp.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (type === "ALPH" || type === "VP8 " || type === "VP8L") {
      chunks.push(webp.subarray(offset, end));
    }
    offset = end;
  }
  return chunks;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const padding = data.length % 2 === 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concat([new TextEncoder().encode(type), uint32(data.length), data, padding]);
}

function uint24(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

interface RgbaPngProps extends Size {
  rgba: Uint8Array;
}

function rgbaPng(props: RgbaPngProps): Uint8Array {
  const stride = props.width * 4;
  const raw = new Uint8Array((stride + 1) * props.height);
  for (let row = 0; row < props.height; row++) {
    raw.set(props.rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, props.width);
  view.setUint32(4, props.height);
  header[8] = 8;
  header[9] = 6;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Array<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
