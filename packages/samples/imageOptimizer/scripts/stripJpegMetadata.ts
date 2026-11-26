import { basename } from "node:path";

const startOfImage = 0xd8;
const endOfImage = 0xd9;
const startOfScan = 0xda;
const applicationOne = 0xe1;
const applicationTwo = 0xe2;
const orientationTag = 0x0112;

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: bun imageOptimizer/scripts/stripJpegMetadata.ts <image.jpg>...");
  process.exit(1);
}

for (const path of paths) {
  const input = new Uint8Array(await Bun.file(path).arrayBuffer());
  const { output, orientation, removed } = stripJpegMetadata(input);
  await Bun.write(path, output);
  console.log(
    `${basename(path)}: ${input.length} -> ${output.length} bytes, orientation ${orientation ?? "none"}, removed ${removed.join(", ") || "nothing"}`,
  );
}

interface StripResult {
  output: Uint8Array;
  orientation: number | undefined;
  removed: Array<string>;
}

function stripJpegMetadata(input: Uint8Array): StripResult {
  if (input[0] !== 0xff || input[1] !== startOfImage) {
    throw new Error("Not a JPEG");
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const kept: Array<Uint8Array> = [input.subarray(0, 2)];
  const removed: Array<string> = [];
  let orientation: number | undefined;
  let offset = 2;

  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new Error(`Bad marker at ${offset}`);
    const marker = input[offset + 1] ?? 0;
    if (marker === startOfScan) {
      const end = findEndOfImage({ input, from: offset });
      kept.push(input.subarray(offset, end));
      if (end < input.length) removed.push(`${input.length - end} trailing bytes`);
      break;
    }
    const length = view.getUint16(offset + 2);
    const segment = input.subarray(offset, offset + 2 + length);
    const body = segment.subarray(4);
    offset += 2 + length;

    if (marker === applicationOne && startsWith({ bytes: body, text: "Exif\0\0" })) {
      orientation = readOrientation(body.subarray(6));
      removed.push("Exif");
      continue;
    }
    if (marker === applicationOne) {
      removed.push("XMP");
      continue;
    }
    if (marker === applicationTwo && !startsWith({ bytes: body, text: "ICC_PROFILE\0" })) {
      removed.push("MPF");
      continue;
    }
    if (marker === 0xed || marker === 0xee || marker === 0xfe) {
      removed.push(marker === 0xed ? "IPTC" : marker === 0xee ? "Adobe" : "comment");
      continue;
    }
    kept.push(segment);
  }

  if (orientation != null && orientation !== 1) {
    kept.splice(1, 0, orientationOnlyExif(orientation));
  }
  return { output: concat(kept), orientation, removed };
}

function readOrientation(tiff: Uint8Array): number | undefined {
  const littleEndian = tiff[0] === 0x49;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifdOffset = view.getUint32(4, littleEndian);
  const entries = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < entries; index++) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (view.getUint16(entryOffset, littleEndian) === orientationTag) {
      return view.getUint16(entryOffset + 8, littleEndian);
    }
  }
  return undefined;
}

function orientationOnlyExif(orientation: number): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]);
  view.setUint32(4, 8);
  view.setUint16(8, 1);
  view.setUint16(10, orientationTag);
  view.setUint16(12, 3);
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  const identifier = new TextEncoder().encode("Exif\0\0");
  const length = 2 + identifier.length + tiff.length;
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, applicationOne]);
  new DataView(segment.buffer).setUint16(2, length);
  segment.set(identifier, 4);
  segment.set(tiff, 4 + identifier.length);
  return segment;
}

function findEndOfImage(props: { input: Uint8Array; from: number }): number {
  const { input } = props;
  const length = new DataView(input.buffer, input.byteOffset).getUint16(props.from + 2);
  let offset = props.from + 2 + length;
  while (offset < input.length - 1) {
    if (input[offset] === 0xff) {
      const next = input[offset + 1] ?? 0;
      if (next === endOfImage) return offset + 2;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (next === startOfScan) {
        const scanLength = new DataView(input.buffer, input.byteOffset).getUint16(offset + 2);
        offset += 2 + scanLength;
        continue;
      }
      const segmentLength = new DataView(input.buffer, input.byteOffset).getUint16(offset + 2);
      offset += 2 + segmentLength;
      continue;
    }
    offset++;
  }
  return input.length;
}

function startsWith(props: { bytes: Uint8Array; text: string }): boolean {
  return Array.from(props.text).every(
    (character, index) => props.bytes[index] === character.charCodeAt(0),
  );
}

function concat(parts: Array<Uint8Array>): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
