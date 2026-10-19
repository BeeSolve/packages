export const grains = ["hour", "day", "month"] as const;
export type Grain = (typeof grains)[number];

export const dimensions = ["status", "country", "device"] as const;
export type Dimension = (typeof dimensions)[number];

export const tiers = ["all", "real", "watch"] as const;
export type Tier = (typeof tiers)[number];

export const defaultTier: Tier = "all";

/**
 * The partition-key segment for a tier. The `all` tier is the empty string so
 * its keys are byte-identical to the pre-tier schema (`totals#<grain>`,
 * `breakdown#<dimension>#…`, `applied#<grain>#…`); `real`/`watch` insert
 * `#real`/`#watch` after the entity prefix and `<tier>-` before a marker grain.
 */
export function tierSegment(tier: Tier): string {
  return tier === "all" ? "" : `#${tier}`;
}

export function tierMarkerSegment(tier: Tier): string {
  return tier === "all" ? "" : `${tier}-`;
}
