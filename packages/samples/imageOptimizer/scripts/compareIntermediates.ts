import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";

Bun.Image.backend = "bun";

const defaultSampleDir = join(import.meta.dir, "..", "photos");
const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
const defaultBuckets = [500, 1000, 1500, 2000, 2500, 3000];
const defaultWidths = [150, 250, 400, 600, 750, 1000, 1400, 1800];

type FinalFormat = "webp" | "jpg" | "png";

interface Variant {
  name: string;
  extension: string;
  encode: (image: Bun.Image) => Bun.Image;
}

const variants: Record<string, Variant> = {
  webp90: { name: "webp90", extension: "webp", encode: (image) => image.webp({ quality: 90 }) },
  webp95: { name: "webp95", extension: "webp", encode: (image) => image.webp({ quality: 95 }) },
  webp100: { name: "webp100", extension: "webp", encode: (image) => image.webp({ quality: 100 }) },
  lossless: {
    name: "lossless",
    extension: "webp",
    encode: (image) => image.webp({ lossless: true }),
  },
  png: { name: "png", extension: "png", encode: (image) => image.png() },
};

interface Pixels {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

interface Metrics {
  meanAbsoluteDifference: number;
  psnr: number;
  maxDifference: number;
}

interface Candidate {
  name: string;
  file: string;
  bytes: number;
  milliseconds: number;
  metrics: Metrics;
  diffFile: string;
}

interface Row {
  targetWidth: number;
  targetHeight: number;
  bucket: number | undefined;
  referenceFile: string;
  candidates: Array<Candidate>;
  note?: string;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    widths: { type: "string" },
    buckets: { type: "string" },
    variants: { type: "string", default: "webp95,webp100,lossless" },
    format: { type: "string", default: "webp" },
    quality: { type: "string", default: "75" },
    "min-ratio": { type: "string", default: "1.5" },
    "diff-gain": { type: "string", default: "10" },
  },
});

const input = resolve(positionals[0] ?? defaultSampleDir);
const outputRoot = resolve(values.out ?? "/tmp/image-optimizer-compare");

const finalFormat = parseFinalFormat(values.format);
const finalQuality = Number(values.quality);
const minRatio = Number(values["min-ratio"]);
const diffGain = Number(values["diff-gain"]);
const buckets = parseNumbers(values.buckets) ?? defaultBuckets;
const selectedVariants = (values.variants ?? "").split(",").map((name) => {
  const variant = variants[name.trim()];
  if (variant == null) {
    throw new Error(`Unknown variant "${name}". Available: ${Object.keys(variants).join(", ")}`);
  }
  return variant;
});

const inputPaths = await listImages(input);
if (inputPaths.length === 0) {
  console.error(`No images found in ${input}`);
  process.exit(1);
}

let inputPath = "";
let source = new Uint8Array();
let metadata: Bun.Image.Metadata = { width: 0, height: 0, format: "jpeg" };
let outDir = "";
let rows: Array<Row> = [];
let intermediateCache: Record<string, { bytes: Uint8Array; file: string; milliseconds: number }> =
  {};

const finished: Array<{ name: string; indexFile: string }> = [];
for (const path of inputPaths) {
  await compareImage(path);
}
await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, "index.html"), renderOverview());
console.log(`open ${join(outputRoot, "index.html")}`);

async function compareImage(path: string): Promise<void> {
  inputPath = path;
  source = new Uint8Array(await Bun.file(path).arrayBuffer());
  metadata = await new Bun.Image(source).metadata();
  const name = basename(path, extname(path)).replace(/[^A-Za-z0-9._-]+/g, "_");
  outDir = join(outputRoot, name);
  await mkdir(outDir, { recursive: true });
  rows = [];
  intermediateCache = {};
  const widths = (parseNumbers(values.widths) ?? defaultWidths).filter(
    (width) => width < metadata.width,
  );

  console.log(
    `\n${basename(path)}: ${metadata.width}x${metadata.height} ${metadata.format}, ${source.length} bytes, backend ${Bun.Image.backend}`,
  );
  for (const targetWidth of widths) {
    rows.push(await compareWidth(targetWidth));
  }
  printSummary();
  await writeFile(join(outDir, "index.html"), renderHtml());
  finished.push({ name: basename(path), indexFile: `${name}/index.html` });
}

async function compareWidth(targetWidth: number): Promise<Row> {
  const targetHeight = Math.max(1, Math.round((metadata.height * targetWidth) / metadata.width));
  const prefix = `w${targetWidth}`;
  const referenceBytes = await new Bun.Image(source)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .png()
    .bytes();
  const referenceFile = `${prefix}-reference.png`;
  await Bun.write(join(outDir, referenceFile), referenceBytes);
  const referencePixels = decodePng(referenceBytes);

  const row: Row = { targetWidth, targetHeight, bucket: undefined, referenceFile, candidates: [] };
  row.candidates.push(
    await measureCandidate({
      name: "direct",
      file: `${prefix}-direct.${finalFormat}`,
      referencePixels,
      produce: () => encodeFinal(new Bun.Image(source)),
      targetWidth,
      targetHeight,
      prefix,
    }),
  );

  const requiredScale = Math.max(targetWidth / metadata.width, targetHeight / metadata.height);
  const bucket = selectBucket(requiredScale);
  row.bucket = bucket;
  if (bucket == null) {
    row.note = "no bucket selected, original is used directly";
    return row;
  }

  for (const variant of selectedVariants) {
    const intermediate = await getIntermediate({ bucket, variant });
    row.candidates.push(
      await measureCandidate({
        name: `via ${variant.name} @${bucket}`,
        file: `${prefix}-via-${variant.name}-${bucket}.${finalFormat}`,
        referencePixels,
        produce: () => encodeFinal(new Bun.Image(intermediate.bytes)),
        targetWidth,
        targetHeight,
        prefix,
      }),
    );
  }
  return row;

  function encodeFinal(image: Bun.Image): Promise<Uint8Array> {
    const resized = image.resize(targetWidth, targetHeight, { fit: "fill" });
    if (finalFormat === "webp") return resized.webp({ quality: finalQuality }).bytes();
    if (finalFormat === "jpg") return resized.jpeg({ quality: finalQuality }).bytes();
    return resized.png().bytes();
  }
}

interface MeasureProps {
  name: string;
  file: string;
  referencePixels: Pixels;
  produce: () => Promise<Uint8Array>;
  targetWidth: number;
  targetHeight: number;
  prefix: string;
}

async function measureCandidate(props: MeasureProps): Promise<Candidate> {
  const start = performance.now();
  const bytes = await props.produce();
  const milliseconds = performance.now() - start;
  await Bun.write(join(outDir, props.file), bytes);
  const decoded = decodePng(await new Bun.Image(bytes).png().bytes());
  const metrics = compare({ reference: props.referencePixels, candidate: decoded });
  const diffFile = props.file.replace(/\.[a-z]+$/, "-diff.png");
  await Bun.write(
    join(outDir, diffFile),
    encodePng(differenceImage({ reference: props.referencePixels, candidate: decoded })),
  );
  return {
    name: props.name,
    file: props.file,
    bytes: bytes.length,
    milliseconds,
    metrics,
    diffFile,
  };
}

interface IntermediateProps {
  bucket: number;
  variant: Variant;
}

async function getIntermediate(props: IntermediateProps): Promise<{
  bytes: Uint8Array;
  file: string;
  milliseconds: number;
}> {
  const key = `${props.variant.name}@${props.bucket}`;
  const cached = intermediateCache[key];
  if (cached != null) return cached;
  const scale = props.bucket / Math.max(metadata.width, metadata.height);
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));
  const start = performance.now();
  const bytes = await props.variant
    .encode(new Bun.Image(source).resize(width, height, { fit: "fill" }))
    .bytes();
  const file = `intermediate-${props.variant.name}-${props.bucket}.${props.variant.extension}`;
  await Bun.write(join(outDir, file), bytes);
  const created = { bytes, file, milliseconds: performance.now() - start };
  intermediateCache[key] = created;
  console.log(
    `intermediate ${key} ${width}x${height} ${bytes.length} bytes in ${created.milliseconds.toFixed(0)} ms`,
  );
  return created;
}

function selectBucket(requiredScale: number): number | undefined {
  const longestEdge = Math.max(metadata.width, metadata.height);
  return [...buckets]
    .sort((left, right) => left - right)
    .find((bucket) => bucket / longestEdge >= requiredScale && bucket * minRatio <= longestEdge);
}

function compare(props: { reference: Pixels; candidate: Pixels }): Metrics {
  const { reference, candidate } = props;
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `Size mismatch ${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}`,
    );
  }
  const channels = Math.min(reference.channels, candidate.channels, 3);
  let sum = 0;
  let squared = 0;
  let max = 0;
  let count = 0;
  for (let pixel = 0; pixel < reference.width * reference.height; pixel++) {
    for (let channel = 0; channel < channels; channel++) {
      const difference = Math.abs(
        byteAt(reference.data, pixel * reference.channels + channel) -
          byteAt(candidate.data, pixel * candidate.channels + channel),
      );
      sum += difference;
      squared += difference * difference;
      max = Math.max(max, difference);
      count++;
    }
  }
  const meanSquared = squared / count;
  return {
    meanAbsoluteDifference: sum / count,
    psnr: meanSquared === 0 ? Infinity : 10 * Math.log10((255 * 255) / meanSquared),
    maxDifference: max,
  };
}

function differenceImage(props: { reference: Pixels; candidate: Pixels }): Pixels {
  const { reference, candidate } = props;
  const data = new Uint8Array(reference.width * reference.height * 3);
  const channels = Math.min(reference.channels, candidate.channels, 3);
  for (let pixel = 0; pixel < reference.width * reference.height; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      const sourceChannel = Math.min(channel, channels - 1);
      const difference = Math.abs(
        byteAt(reference.data, pixel * reference.channels + sourceChannel) -
          byteAt(candidate.data, pixel * candidate.channels + sourceChannel),
      );
      data[pixel * 3 + channel] = 255 - Math.min(255, difference * diffGain);
    }
  }
  return { width: reference.width, height: reference.height, channels: 3, data };
}

function decodePng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Array<Uint8Array> = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
      const detected = channelsByColorType[colorType ?? -1];
      if (bitDepth !== 8 || interlace !== 0 || detected == null) {
        throw new Error(
          `Unsupported PNG (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`,
        );
      }
      channels = detected;
    }
    if (type === "IDAT") parts.push(data);
    offset += 12 + length;
  }
  const compressed = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of parts) {
    compressed.set(part, position);
    position += part.length;
  }
  const raw = inflateSync(compressed);
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = byteAt(raw, row * (stride + 1));
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? byteAt(out, row * stride + index - channels) : 0;
      const up = row > 0 ? byteAt(out, (row - 1) * stride + index) : 0;
      const upLeft =
        row > 0 && index >= channels ? byteAt(out, (row - 1) * stride + index - channels) : 0;
      out[row * stride + index] =
        (byteAt(line, index) + predictor({ filter, left, up, upLeft })) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function predictor(props: { filter: number; left: number; up: number; upLeft: number }): number {
  const { filter, left, up, upLeft } = props;
  if (filter === 0) return 0;
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
  throw new Error(`Unknown PNG filter ${filter}`);
}

function encodePng(pixels: Pixels): Uint8Array {
  const stride = pixels.width * pixels.channels;
  const raw = new Uint8Array((stride + 1) * pixels.height);
  for (let row = 0; row < pixels.height; row++) {
    raw.set(pixels.data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, pixels.width);
  view.setUint32(4, pixels.height);
  header[8] = 8;
  header[9] = pixels.channels === 4 ? 6 : 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function printSummary(): void {
  console.log(
    [
      "size".padEnd(11),
      "candidate".padEnd(26),
      "bytes".padStart(8),
      "MAE".padStart(7),
      "PSNR dB".padStart(8),
      "max".padStart(4),
    ].join(" "),
  );
  for (const row of rows) {
    for (const candidate of row.candidates) {
      console.log(
        [
          `${row.targetWidth}x${row.targetHeight}`.padEnd(11),
          candidate.name.padEnd(26),
          String(candidate.bytes).padStart(8),
          candidate.metrics.meanAbsoluteDifference.toFixed(3).padStart(7),
          candidate.metrics.psnr.toFixed(2).padStart(8),
          String(candidate.metrics.maxDifference).padStart(4),
        ].join(" "),
      );
    }
    if (row.note != null) console.log(`${row.targetWidth}x${row.targetHeight}: ${row.note}`);
  }
}

function renderHtml(): string {
  const sections = rows.map((row) => {
    const cells = [
      `<figure><img src="${row.referenceFile}" loading="lazy"><figcaption>reference (lossless direct resize)</figcaption></figure>`,
      ...row.candidates.map(
        (candidate) =>
          `<figure><img src="${candidate.file}" data-alt="${candidate.diffFile}" loading="lazy" title="click to toggle difference x${diffGain}"><figcaption><b>${candidate.name}</b><br>${candidate.bytes} B, ${candidate.milliseconds.toFixed(0)} ms<br>MAE ${candidate.metrics.meanAbsoluteDifference.toFixed(3)}, PSNR ${candidate.metrics.psnr.toFixed(2)} dB, max ${candidate.metrics.maxDifference}</figcaption></figure>`,
      ),
    ].join("\n");
    const title = `${row.targetWidth}x${row.targetHeight}${row.bucket == null ? "" : `, bucket ${row.bucket}`}${row.note == null ? "" : ` (${row.note})`}`;
    return `<section><h2>${title}</h2><div class="row">${cells}</div></section>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>intermediate comparison</title>
<style>body{font:14px system-ui;margin:16px;background:#222;color:#ddd}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}img{display:block;max-width:100%;image-rendering:auto;cursor:pointer;background:#fff}figcaption{margin-top:4px;max-width:520px}</style>
<h1>${basename(inputPath)} ${metadata.width}x${metadata.height}, final ${finalFormat} q${finalQuality}, backend ${Bun.Image.backend}</h1>
<p>Click an image to toggle its difference to the reference (amplified x${diffGain}, white = identical). Metrics are against the lossless direct resize of the original, computed on the decoded shipped output.</p>
${sections.join("\n")}
<script>document.querySelectorAll("img[data-alt]").forEach(img=>{const a=img.src,b=new URL(img.dataset.alt,a).href;img.onclick=()=>{img.src=img.src===a?b:a}})</script>`;
}

async function listImages(path: string): Promise<Array<string>> {
  const entries = await readdir(path).catch(() => undefined);
  if (entries == null) return [path];
  return entries
    .filter((entry) => imageExtensions.includes(extname(entry).toLowerCase()))
    .sort()
    .map((entry) => join(path, entry));
}

function renderOverview(): string {
  const items = finished
    .map((item) => `<li><a href="${item.indexFile}">${item.name}</a></li>`)
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>intermediate comparison</title><body style="font:16px system-ui;margin:24px"><h1>Intermediate comparison</h1><ul>${items}</ul></body>`;
}

function parseNumbers(value: string | undefined): Array<number> | undefined {
  if (value == null) return undefined;
  return value.split(",").map((part) => Number(part.trim()));
}

function parseFinalFormat(value: string | undefined): FinalFormat {
  if (value === "webp" || value === "jpg" || value === "png") return value;
  throw new Error(`--format must be webp, jpg or png, got "${value}"`);
}

function byteAt(data: Uint8Array, index: number): number {
  return data[index] ?? 0;
}
