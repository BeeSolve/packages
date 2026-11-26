import { negotiateFormat } from "./accept";
import { selectBucket } from "./buckets";
import { computeGeometry, rotateDimensions } from "./geometry";
import type { Dimensions, Geometry } from "./geometry";
import { intermediateKey } from "./intermediates";
import type { IntermediateStore } from "./intermediates";
import type { ImageParams } from "./params";
import type { FlipMode, OutputFormat } from "./query";
import { textResponse } from "./responses";
import type { ImageSource, SourceStat } from "./source";

export interface PipelineConfig {
  cacheTtlSeconds: number;
  sizeBuckets: ReadonlyArray<number>;
  maxSourceBytes: number;
  maxPixels: number;
  minSourceToBucketRatio: number;
}

export interface ProcessImageProps {
  source: ImageSource;
  store: IntermediateStore;
  key: string;
  params: ImageParams;
  accept: string | undefined;
  config: PipelineConfig;
}

export type Outcome =
  | { kind: "optimized" }
  | { kind: "placeholder" }
  | { kind: "passthrough"; format: string };

export const outcomeHeaderName = "X-Image-Optimizer";

const sniffLengths = [16 * 1024, 128 * 1024, 1024 * 1024];
const intermediateQuality = 95;
const placeholderLongestEdge = 64;

const contentTypes: Record<OutputFormat, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  png: "image/png",
};

const passthroughContentTypes: Record<string, string> = {
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tiff: "image/tiff",
  heic: "image/heic",
  avif: "image/avif",
  "animated-webp": "image/webp",
};

/** Builds the value of the `X-Image-Optimizer` response header. */
export function outcomeHeader(outcome: Outcome): string {
  if (outcome.kind === "optimized") return "optimized";
  if (outcome.kind === "placeholder") return "placeholder";
  if (outcome.kind === "passthrough") {
    return `passthrough; reason=unsupported-format; format=${outcome.format.replace(/[^a-z0-9-]/g, "")}`;
  }
  return assertUnreachable(outcome);
}

/**
 * Reads the original from the source, decides between passthrough and processing, and returns
 * the response. Missing keys return 404, sources over a limit or undecodable ones return 422.
 */
export async function processImage(props: ProcessImageProps): Promise<Response> {
  const { source, key, config } = props;
  const stat = await source.stat(key);
  if (stat == null) return textResponse(404, "Not Found");

  const sniffed = await sniff({ source, key, stat, maxPixels: config.maxPixels });
  if (sniffed.kind === "rejected") return textResponse(422, sniffed.message);
  if (sniffed.kind === "unsupported") {
    return passthroughResponse({ source, key, stat, format: sniffed.format, config });
  }
  if (stat.size > config.maxSourceBytes) {
    return textResponse(422, `Image is larger than ${config.maxSourceBytes} bytes`);
  }

  try {
    return await renderImage({ ...props, stat, original: sniffed });
  } catch (error) {
    const code = errorCode(error);
    if (code === "ERR_IMAGE_TOO_MANY_PIXELS") return textResponse(422, "Image has too many pixels");
    if (code === "ERR_IMAGE_DECODE_FAILED") return textResponse(422, "Image cannot be decoded");
    throw error;
  }
}

type ProcessableFormat = "jpeg" | "png" | "webp";

type Sniffed =
  | { kind: "image"; format: ProcessableFormat; width: number; height: number }
  | { kind: "unsupported"; format: string }
  | { kind: "rejected"; message: string };

interface SniffProps {
  source: ImageSource;
  key: string;
  stat: SourceStat;
  maxPixels: number;
}

async function sniff(props: SniffProps): Promise<Sniffed> {
  for (const length of sniffLengths) {
    const bytes = await props.source.readRange({ key: props.key, length });
    if (isAnimatedWebp(bytes)) return { kind: "unsupported", format: "animated-webp" };
    try {
      const metadata = await new Bun.Image(bytes, { maxPixels: props.maxPixels }).metadata();
      if (isProcessableFormat(metadata.format)) {
        return {
          kind: "image",
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
        };
      }
      return { kind: "unsupported", format: metadata.format };
    } catch (error) {
      const code = errorCode(error);
      if (code === "ERR_IMAGE_UNKNOWN_FORMAT") {
        return { kind: "unsupported", format: sniffTextFormat(bytes) };
      }
      if (code === "ERR_IMAGE_FORMAT_UNSUPPORTED") return { kind: "unsupported", format: "other" };
      if (code === "ERR_IMAGE_TOO_MANY_PIXELS") {
        return { kind: "rejected", message: "Image has too many pixels" };
      }
      if (code !== "ERR_IMAGE_DECODE_FAILED") throw error;
      if (bytes.length >= props.stat.size) {
        return { kind: "rejected", message: "Image cannot be decoded" };
      }
    }
  }
  return { kind: "rejected", message: "Image header is too large" };
}

/**
 * `Bun.Image` reads the header of an animated WebP but cannot decode its frames, so animated
 * WebP is passed through like GIF. The VP8X chunk carries the animation flag.
 */
function isAnimatedWebp(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 21) return false;
  if (ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP" || ascii(12, 16) !== "VP8X") return false;
  return ((bytes[20] ?? 0) & 0x02) !== 0;
}

function isProcessableFormat(format: Bun.Image.Format): format is ProcessableFormat {
  return format === "jpeg" || format === "png" || format === "webp";
}

function sniffTextFormat(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes.subarray(0, 1024));
  return text.includes("<svg") ? "svg" : "unknown";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error == null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

interface PassthroughProps {
  source: ImageSource;
  key: string;
  stat: SourceStat;
  format: string;
  config: PipelineConfig;
}

/**
 * The content type follows the sniffed format when it is known, so a GIF stored under a `.jpg`
 * key is not served as `image/jpeg`. Unknown content keeps the type stored in S3.
 */
function passthroughResponse(props: PassthroughProps): Response {
  return new Response(props.source.stream(props.key), {
    headers: responseHeaders({
      contentType: passthroughContentTypes[props.format] ?? props.stat.contentType,
      outcome: { kind: "passthrough", format: props.format },
      cacheTtlSeconds: props.config.cacheTtlSeconds,
    }),
  });
}

interface ResponseHeadersProps {
  contentType: string;
  outcome: Outcome;
  cacheTtlSeconds: number;
}

function responseHeaders(props: ResponseHeadersProps): Record<string, string> {
  return {
    "Content-Type": props.contentType,
    "Cache-Control": `public, max-age=${props.cacheTtlSeconds}`,
    Vary: "Accept",
    "X-Content-Type-Options": "nosniff",
    [outcomeHeaderName]: outcomeHeader(props.outcome),
  };
}

interface RenderProps extends ProcessImageProps {
  stat: SourceStat;
  original: Extract<Sniffed, { kind: "image" }>;
}

async function renderImage(props: RenderProps): Promise<Response> {
  const { params, config, original } = props;
  const sourceDimensions = { width: original.width, height: original.height };
  const geometry = computeGeometry({ source: sourceDimensions, params });
  const target = params.placeholder
    ? shrinkToLongestEdge({ dimensions: geometry.resize, longestEdge: placeholderLongestEdge })
    : geometry.resize;

  const input = await selectInput({ ...props, sourceDimensions, geometry, target });
  if (input.kind === "rejected") return textResponse(422, input.message);

  const image = new Bun.Image(input.bytes, { maxPixels: config.maxPixels });
  applyOrientation({ image, geometry });
  const rotated = rotateDimensions({ source: input.dimensions, rotation: geometry.rotate });
  if (rotated.width !== target.width || rotated.height !== target.height) {
    image.resize(target.width, target.height, { fit: "fill" });
  }

  if (params.placeholder) {
    const png = await image.png().bytes();
    const dataUrl = await new Bun.Image(png).placeholder();
    return new Response(dataUrl, {
      headers: responseHeaders({
        contentType: "text/plain; charset=utf-8",
        outcome: { kind: "placeholder" },
        cacheTtlSeconds: config.cacheTtlSeconds,
      }),
    });
  }

  const format = outputFormat({ params, accept: props.accept, original: original.format });
  const body = await encode({ image, format, quality: params.q }).blob();
  return new Response(body, {
    headers: responseHeaders({
      contentType: contentTypes[format],
      outcome: { kind: "optimized" },
      cacheTtlSeconds: config.cacheTtlSeconds,
    }),
  });
}

interface SelectInputProps extends RenderProps {
  sourceDimensions: Dimensions;
  geometry: Geometry;
  target: Dimensions;
}

type Input =
  | { kind: "input"; bytes: Uint8Array; dimensions: Dimensions }
  | { kind: "rejected"; message: string };

async function selectInput(props: SelectInputProps): Promise<Input> {
  const { source, key, config, sourceDimensions, target } = props;
  const rotatedSource = rotateDimensions({
    source: sourceDimensions,
    rotation: props.geometry.rotate,
  });
  const requiredScale = Math.max(
    target.width / rotatedSource.width,
    target.height / rotatedSource.height,
  );
  const bucket = selectBucket({
    source: sourceDimensions,
    requiredScale,
    sizeBuckets: config.sizeBuckets,
    minSourceToBucketRatio: config.minSourceToBucketRatio,
  });

  if (bucket == null) {
    const bytes = await readOriginal({ source, key, maxSourceBytes: config.maxSourceBytes });
    if (bytes == null) return oversized(config.maxSourceBytes);
    return { kind: "input", bytes, dimensions: sourceDimensions };
  }

  const dimensions = scaleToLongestEdge({ dimensions: sourceDimensions, longestEdge: bucket });
  const name = intermediateKey({ sourceKey: key, sourceEtag: props.stat.etag, bucket });
  const stored = await props.store.get(name);
  if (stored != null) return { kind: "input", bytes: stored, dimensions };

  const bytes = await readOriginal({ source, key, maxSourceBytes: config.maxSourceBytes });
  if (bytes == null) return oversized(config.maxSourceBytes);
  const intermediate = await new Bun.Image(bytes, { maxPixels: config.maxPixels })
    .resize(dimensions.width, dimensions.height, { fit: "fill" })
    .webp({ quality: intermediateQuality })
    .bytes();
  await props.store.put(name, intermediate).catch((error: unknown) => {
    console.error(`Could not store intermediate ${name}`, error);
  });
  return { kind: "input", bytes: intermediate, dimensions };
}

function oversized(maxSourceBytes: number): Input {
  return { kind: "rejected", message: `Image is larger than ${maxSourceBytes} bytes` };
}

interface ReadOriginalProps {
  source: ImageSource;
  key: string;
  maxSourceBytes: number;
}

async function readOriginal(props: ReadOriginalProps): Promise<Uint8Array | undefined> {
  const bytes = await props.source.read(props.key);
  return bytes.length > props.maxSourceBytes ? undefined : bytes;
}

interface ScaleProps {
  dimensions: Dimensions;
  longestEdge: number;
}

function scaleToLongestEdge(props: ScaleProps): Dimensions {
  const scale = props.longestEdge / Math.max(props.dimensions.width, props.dimensions.height);
  return {
    width: Math.max(1, Math.round(props.dimensions.width * scale)),
    height: Math.max(1, Math.round(props.dimensions.height * scale)),
  };
}

function shrinkToLongestEdge(props: ScaleProps): Dimensions {
  if (Math.max(props.dimensions.width, props.dimensions.height) <= props.longestEdge) {
    return props.dimensions;
  }
  return scaleToLongestEdge(props);
}

interface OrientationProps {
  image: Bun.Image;
  geometry: Geometry;
}

function applyOrientation(props: OrientationProps): void {
  const { image, geometry } = props;
  if (geometry.rotate !== 0) image.rotate(geometry.rotate);
  if (geometry.flip == null) return;
  flipOperations(geometry.flip).forEach((operation) => operation(image));
}

function flipOperations(flip: FlipMode): Array<(image: Bun.Image) => Bun.Image> {
  if (flip === "h") return [(image) => image.flop()];
  if (flip === "v") return [(image) => image.flip()];
  if (flip === "hv") return [(image) => image.flop(), (image) => image.flip()];
  return assertUnreachable(flip);
}

interface OutputFormatProps {
  params: ImageParams;
  accept: string | undefined;
  original: ProcessableFormat;
}

function outputFormat(props: OutputFormatProps): OutputFormat {
  if (props.params.fm != null) return props.params.fm;
  if (negotiateFormat(props.accept) === "webp") return "webp";
  if (props.original === "jpeg") return "jpg";
  return props.original;
}

interface EncodeProps {
  image: Bun.Image;
  format: OutputFormat;
  quality: number;
}

function encode(props: EncodeProps): Bun.Image {
  if (props.format === "webp") return props.image.webp({ quality: props.quality });
  if (props.format === "jpg") return props.image.jpeg({ quality: props.quality });
  if (props.format === "png") return props.image.png();
  return assertUnreachable(props.format);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
