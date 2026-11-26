export type NegotiatedFormat = "webp" | "original";

/**
 * Returns "webp" only when `image/webp` is listed with a quality greater than zero.
 * `*` and `image/*` ranges alone do not select WebP, so crawlers and curl get the original.
 */
export function negotiateFormat(acceptHeader: string | undefined): NegotiatedFormat {
  if (acceptHeader == null) return "original";

  const acceptsWebp = acceptHeader.split(",").some((range) => {
    const parts = range.split(";");
    const mediaType = (parts[0] ?? "").trim().toLowerCase();
    return mediaType === "image/webp" && readQuality(parts.slice(1)) > 0;
  });
  return acceptsWebp ? "webp" : "original";
}

function readQuality(parameters: ReadonlyArray<string>): number {
  const parameter = parameters.find(
    (candidate) =>
      candidate.indexOf("=") !== -1 &&
      candidate.slice(0, candidate.indexOf("=")).trim().toLowerCase() === "q",
  );
  if (parameter == null) return 1;
  const value = parameter.slice(parameter.indexOf("=") + 1).trim();
  if (!/^\d(\.\d{0,3})?$/.test(value)) return 0;
  return Number(value);
}
