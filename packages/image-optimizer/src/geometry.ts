import type { ImageParams } from "./params";
import type { FlipMode, Rotation } from "./query";

export interface Dimensions {
  width: number;
  height: number;
}

export interface Geometry {
  /** Box to pass to `Bun.Image#resize` together with `fit` and `withoutEnlargement`. */
  requested: Dimensions;
  /** Dimensions of the final image. */
  resize: Dimensions;
  fit: "fill" | "inside";
  withoutEnlargement: boolean;
  rotate: Rotation;
  flip?: FlipMode;
  /** Smallest uniform scale of the oriented source that still covers the final size on both axes. */
  requiredScale: number;
}

export interface ComputeGeometryProps {
  /** Dimensions after EXIF orientation, before the `rot` parameter. */
  source: Dimensions;
  params: ImageParams;
}

/**
 * Computes every size before any pixel work. The result matches the dimensions `Bun.Image`
 * produces for the same `resize` call, which the tests verify against the real library.
 */
export function computeGeometry(props: ComputeGeometryProps): Geometry {
  const { params } = props;
  const oriented = rotateDimensions({ source: props.source, rotation: params.rot });
  const requested = requestedBox({ oriented, params });
  const fit = params.fit === "scale" ? "fill" : "inside";
  const withoutEnlargement = params.fit === "max";
  const resize = finalDimensions({ oriented, requested, fit, withoutEnlargement });

  return {
    requested,
    resize,
    fit,
    withoutEnlargement,
    rotate: params.rot,
    ...(params.flip == null ? {} : { flip: params.flip }),
    requiredScale: Math.max(resize.width / oriented.width, resize.height / oriented.height),
  };
}

export interface RotateDimensionsProps {
  source: Dimensions;
  rotation: Rotation;
}

/** Dimensions of an image after it was rotated by `rotation`. */
export function rotateDimensions(props: RotateDimensionsProps): Dimensions {
  const swap = props.rotation === 90 || props.rotation === 270;
  return swap
    ? { width: props.source.height, height: props.source.width }
    : { width: props.source.width, height: props.source.height };
}

interface RequestedBoxProps {
  oriented: Dimensions;
  params: ImageParams;
}

function requestedBox(props: RequestedBoxProps): Dimensions {
  const { oriented, params } = props;
  const width = params.w == null ? undefined : Math.round(params.w * params.dpr);
  const height = params.h == null ? undefined : Math.round(params.h * params.dpr);

  if (width != null && height != null) return { width, height };
  if (width != null) {
    return { width, height: atLeastOne((oriented.height * width) / oriented.width) };
  }
  if (height != null) {
    return { width: atLeastOne((oriented.width * height) / oriented.height), height };
  }
  return oriented;
}

interface FinalDimensionsProps {
  oriented: Dimensions;
  requested: Dimensions;
  fit: "fill" | "inside";
  withoutEnlargement: boolean;
}

function finalDimensions(props: FinalDimensionsProps): Dimensions {
  const { oriented, requested } = props;
  if (props.fit === "fill") return requested;

  const scale = Math.min(requested.width / oriented.width, requested.height / oriented.height);
  if (props.withoutEnlargement && scale >= 1) return oriented;
  return {
    width: atLeastOne(oriented.width * scale),
    height: atLeastOne(oriented.height * scale),
  };
}

function atLeastOne(value: number): number {
  return Math.max(1, Math.round(value));
}
