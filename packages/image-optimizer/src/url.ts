import { imageLimits } from "./limits";
import { canonicalizeQuery, queryDefaults } from "./query";

export interface GenerateUrlProps {
  /** Origin of the CloudFront distribution, for example `https://xyz.cloudfront.net`. An empty string produces a root-relative URL. */
  baseUrl: string;
  /** Path of the original below the assets prefix, for example `photos/cat.jpg`. The S3 key is `{assetsPathPrefix}/{path}`. */
  path: string;
  /** Path prefix the distribution routes to the image optimizer. Pass `assets` unless the construct was configured differently. */
  assetsPathPrefix: string;
  /**
   * Mutations to apply, at most one per group, in any order (processing order is fixed:
   * rotate, flip, size, output). Pass an empty array for the unmodified original.
   */
  mutations: ReadonlyArray<Mutation>;
}

/**
 * Groups, each used at most once:
 * - size: `fitBox`, `fitWidth`, `fitHeight`, `stretch`
 * - pixelRatio: `pixelRatio`, needs a size mutation
 * - rotation: `rotate`
 * - flip: `flip`
 * - output: `toWebp`, `toJpeg`, `toPng`, `auto`, `placeholder`
 *
 * Optional values fall back to the defaults of the optimizer (`quality` 75). Default values
 * (`quality` 75, `pixelRatio` 1, `enlarge: true`) are never written into the URL, the
 * Lambda applies them, so equivalent mutations always share one cache entry.
 */
export type Mutation =
  | FitBox
  | FitWidth
  | FitHeight
  | Stretch
  | PixelRatio
  | Rotate
  | Flip
  | ToWebp
  | ToJpeg
  | ToPng
  | Auto
  | Placeholder;

/** Fits inside `width` x `height` and keeps the aspect ratio. */
export interface FitBox {
  type: "fitBox";
  width: number;
  height: number;
  /** `false` never makes the image larger than the original, `true` may upscale. */
  enlarge: boolean;
}

/** Resizes to `width` and derives the height from the aspect ratio. */
export interface FitWidth {
  type: "fitWidth";
  width: number;
  enlarge: boolean;
}

/** Resizes to `height` and derives the width from the aspect ratio. */
export interface FitHeight {
  type: "fitHeight";
  height: number;
  enlarge: boolean;
}

/** Stretches to exactly `width` x `height`, the aspect ratio is not kept. */
export interface Stretch {
  type: "stretch";
  width: number;
  height: number;
}

/** Device pixel ratio between 1 and 3, multiplies the size of the size mutation. */
export interface PixelRatio {
  type: "pixelRatio";
  ratio: number;
}

/** Clockwise rotation. */
export interface Rotate {
  type: "rotate";
  degrees: 90 | 180 | 270;
}

export interface Flip {
  type: "flip";
  direction: "horizontal" | "vertical" | "both";
}

/** Always WebP. */
export interface ToWebp {
  type: "toWebp";
  /** 1 to 100. @default 75 */
  quality?: number;
}

/** Always JPEG. */
export interface ToJpeg {
  type: "toJpeg";
  /** 1 to 100. @default 75 */
  quality?: number;
}

/** Always PNG (lossless, no quality). */
export interface ToPng {
  type: "toPng";
}

/** WebP when the browser accepts it, the original format otherwise. */
export interface Auto {
  type: "auto";
  /** 1 to 100. @default 75 */
  quality?: number;
}

/** Replaces the image with a tiny placeholder data URL (`text/plain`). */
export interface Placeholder {
  type: "placeholder";
}

type Group = "size" | "pixelRatio" | "rotation" | "flip" | "output";

/**
 * Builds the URL of an optimized image. The query string is already in the canonical cache key
 * form, so identical mutations always produce an identical URL.
 */
export function generateUrl(props: GenerateUrlProps): string {
  const base = props.baseUrl.replace(/\/+$/, "");
  const prefixSegments = splitPath({ name: "assetsPathPrefix", value: props.assetsPathPrefix });
  const pathSegments = splitPath({ name: "path", value: props.path });
  if (pathSegments.length === 0) throw new Error('"path" must not be empty');
  const encodedPath = [...prefixSegments, ...pathSegments].map(encodeURIComponent).join("/");

  const query = buildQuery(props.mutations);
  return `${base}/${encodedPath}${query === "" ? "" : `?${query}`}`;
}

function buildQuery(mutations: ReadonlyArray<Mutation>): string {
  assertCompatible(mutations);
  const pairs = mutations.flatMap(toPairs);
  const canonical = canonicalizeQuery(pairs.join("&"));
  if ("error" in canonical) throw new Error(canonical.error);
  return canonical.query;
}

function toPairs(mutation: Mutation): Array<string> {
  if (mutation.type === "fitBox") {
    return [
      `w=${dimension({ name: "fitBox.width", value: mutation.width })}`,
      `h=${dimension({ name: "fitBox.height", value: mutation.height })}`,
      ...fitPairs(mutation.enlarge),
    ];
  }
  if (mutation.type === "fitWidth") {
    return [
      `w=${dimension({ name: "fitWidth.width", value: mutation.width })}`,
      ...fitPairs(mutation.enlarge),
    ];
  }
  if (mutation.type === "fitHeight") {
    return [
      `h=${dimension({ name: "fitHeight.height", value: mutation.height })}`,
      ...fitPairs(mutation.enlarge),
    ];
  }
  if (mutation.type === "stretch") {
    return [
      `w=${dimension({ name: "stretch.width", value: mutation.width })}`,
      `h=${dimension({ name: "stretch.height", value: mutation.height })}`,
      "fit=scale",
    ];
  }
  if (mutation.type === "pixelRatio") return pixelRatioPairs(mutation.ratio);
  if (mutation.type === "rotate") return [`rot=${mutation.degrees}`];
  if (mutation.type === "flip") return [`flip=${flipValue(mutation.direction)}`];
  if (mutation.type === "toWebp") {
    return ["fm=webp", ...qualityPairs({ name: "toWebp.quality", value: mutation.quality })];
  }
  if (mutation.type === "toJpeg") {
    return ["fm=jpg", ...qualityPairs({ name: "toJpeg.quality", value: mutation.quality })];
  }
  if (mutation.type === "toPng") return ["fm=png"];
  if (mutation.type === "auto") {
    return qualityPairs({ name: "auto.quality", value: mutation.quality });
  }
  if (mutation.type === "placeholder") return ["placeholder=1"];
  return assertUnreachable(mutation);
}

function groupOf(mutation: Mutation): Group {
  if (
    mutation.type === "fitBox" ||
    mutation.type === "fitWidth" ||
    mutation.type === "fitHeight" ||
    mutation.type === "stretch"
  ) {
    return "size";
  }
  if (mutation.type === "pixelRatio") return "pixelRatio";
  if (mutation.type === "rotate") return "rotation";
  if (mutation.type === "flip") return "flip";
  if (
    mutation.type === "toWebp" ||
    mutation.type === "toJpeg" ||
    mutation.type === "toPng" ||
    mutation.type === "auto" ||
    mutation.type === "placeholder"
  ) {
    return "output";
  }
  return assertUnreachable(mutation);
}

function assertCompatible(mutations: ReadonlyArray<Mutation>): void {
  const seen: Partial<Record<Group, Mutation["type"]>> = {};
  for (const mutation of mutations) {
    const group = groupOf(mutation);
    const existing = seen[group];
    if (existing != null) {
      throw new Error(
        `"${existing}" and "${mutation.type}" both set the ${group}, use only one of them`,
      );
    }
    seen[group] = mutation.type;
  }
  if (seen.pixelRatio != null && seen.size == null) {
    throw new Error('"pixelRatio" needs a size mutation (fitBox, fitWidth, fitHeight or stretch)');
  }
}

function fitPairs(enlarge: boolean): Array<string> {
  const fit = enlarge ? "clip" : "max";
  return fit === queryDefaults.fit ? [] : [`fit=${fit}`];
}

function flipValue(direction: Flip["direction"]): string {
  if (direction === "horizontal") return "h";
  if (direction === "vertical") return "v";
  if (direction === "both") return "hv";
  return assertUnreachable(direction);
}

interface SplitPathProps {
  name: string;
  value: string;
}

function splitPath(props: SplitPathProps): Array<string> {
  const trimmed = props.value.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return [];
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "") throw new Error(`"${props.name}" must not contain empty segments`);
    if (segment === "." || segment === "..") {
      throw new Error(`"${props.name}" must not contain "." or ".." segments`);
    }
  }
  return segments;
}

interface NamedValue {
  name: string;
  value: number;
}

function dimension(props: NamedValue): number {
  return integerInRange({ ...props, min: 1, max: imageLimits.maxDimension });
}

interface QualityProps {
  name: string;
  value: number | undefined;
}

function qualityPairs(props: QualityProps): Array<string> {
  if (props.value == null) return [];
  const value = integerInRange({
    name: props.name,
    value: props.value,
    min: imageLimits.minQuality,
    max: imageLimits.maxQuality,
  });
  return value === queryDefaults.q ? [] : [`q=${value}`];
}

interface RangeProps extends NamedValue {
  min: number;
  max: number;
}

function integerInRange(props: RangeProps): number {
  if (!Number.isInteger(props.value) || props.value < props.min || props.value > props.max) {
    throw new Error(`"${props.name}" must be an integer between ${props.min} and ${props.max}`);
  }
  return props.value;
}

function pixelRatioPairs(value: number): Array<string> {
  if (!Number.isFinite(value) || value < imageLimits.minDpr || value > imageLimits.maxDpr) {
    throw new Error(
      `"pixelRatio.ratio" must be between ${imageLimits.minDpr} and ${imageLimits.maxDpr}`,
    );
  }
  return value === queryDefaults.dpr ? [] : [`dpr=${value}`];
}

function assertUnreachable(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
