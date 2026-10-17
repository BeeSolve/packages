export const grains = ["hour", "day", "month"] as const;
export type Grain = (typeof grains)[number];

export const dimensions = ["status", "country", "device"] as const;
export type Dimension = (typeof dimensions)[number];
