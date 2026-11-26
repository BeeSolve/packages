import { queryDefaults } from "./query";

export const imageLimits = {
  maxDimension: 8192,
  minDpr: 1,
  maxDpr: 3,
  minQuality: 1,
  maxQuality: 100,
  defaultQuality: queryDefaults.q,
} as const;
