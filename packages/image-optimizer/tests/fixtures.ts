import { deflateSync, inflateSync } from "node:zlib";

export type FixtureFormat = "png" | "jpeg" | "webp";

export interface CreateImageProps {
  width: number;
  height: number;
  format: FixtureFormat;
}

export async function createImage(props: CreateImageProps): Promise<Uint8Array> {
  const png = gradientPng({ width: props.width, height: props.height });
  if (props.format === "png") return png;
  const image = new Bun.Image(png);
  if (props.format === "jpeg") return image.jpeg({ quality: 85 }).bytes();
  return image.webp({ quality: 85 }).bytes();
}

interface GradientProps {
  width: number;
  height: number;
}

function gradientPng(props: GradientProps): Uint8Array {
  const { width, height } = props;
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = Math.floor((x / width) * 255);
      raw[offset + 1] = Math.floor((y / height) * 255);
      raw[offset + 2] = (x + y) % 256;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
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

export const gifBytes = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

export const svgBytes = new TextEncoder().encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
);

export interface PixelImageProps {
  width: number;
  height: number;
  pixel: (position: { x: number; y: number }) => [number, number, number];
}

/** Lossless PNG whose pixels are defined by the caller. */
export function createPixelPng(props: PixelImageProps): Uint8Array {
  const stride = props.width * 3 + 1;
  const raw = new Uint8Array(stride * props.height);
  for (let y = 0; y < props.height; y++) {
    for (let x = 0; x < props.width; x++) {
      raw.set(props.pixel({ x, y }), y * stride + 1 + x * 3);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, props.width);
  view.setUint32(4, props.height);
  header[8] = 8;
  header[9] = 2;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export interface Pixels {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

/** Decodes an 8-bit non-interlaced PNG, enough for the PNGs produced by `Bun.Image`. */
export function decodePng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Array<Uint8Array> = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const colorType = bytes[offset + 17];
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 2;
    }
    if (type === "IDAT") parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(concat(parts));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)] ?? 0;
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? (data[row * stride + index - channels] ?? 0) : 0;
      const up = row > 0 ? (data[(row - 1) * stride + index] ?? 0) : 0;
      const upLeft =
        row > 0 && index >= channels ? (data[(row - 1) * stride + index - channels] ?? 0) : 0;
      const value = raw[row * (stride + 1) + 1 + index] ?? 0;
      data[row * stride + index] = (value + predict({ filter, left, up, upLeft })) & 0xff;
    }
  }
  return { width, height, channels, data };
}

export function pixelAt(props: { pixels: Pixels; x: number; y: number }): Array<number> {
  const start = (props.y * props.pixels.width + props.x) * props.pixels.channels;
  return Array.from(props.pixels.data.subarray(start, start + 3));
}

function predict(props: { filter: number; left: number; up: number; upLeft: number }): number {
  const { filter, left, up, upLeft } = props;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) {
    const estimate = left + up - upLeft;
    const distanceLeft = Math.abs(estimate - left);
    const distanceUp = Math.abs(estimate - up);
    const distanceUpLeft = Math.abs(estimate - upLeft);
    if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
    return distanceUp <= distanceUpLeft ? up : upLeft;
  }
  return 0;
}
