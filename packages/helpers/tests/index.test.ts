import { describe, expect, test } from "bun:test";

import {
  assertUnreachable,
  capitalizeFirstLetter,
  isNotNil,
  splitArrayToChunks,
  toggleInArray,
  toRecordByProperty,
} from "../index";

describe("assertUnreachable", () => {
  test("throws an error", () => {
    expect(() => assertUnreachable("x" as never)).toThrow("An unreachable state reached!");
  });
});

describe("isNotNil", () => {
  test("returns true for non-nil values", () => {
    expect(isNotNil(0)).toBe(true);
    expect(isNotNil("")).toBe(true);
    expect(isNotNil(false)).toBe(true);
  });

  test("returns false for null and undefined", () => {
    expect(isNotNil(null)).toBe(false);
    expect(isNotNil(undefined)).toBe(false);
  });
});

describe("toggleInArray", () => {
  test("adds value when not present", () => {
    expect(toggleInArray(3, [1, 2])).toEqual([1, 2, 3]);
  });

  test("removes value when present", () => {
    expect(toggleInArray(2, [1, 2, 3])).toEqual([1, 3]);
  });

  test("handles empty array", () => {
    expect(toggleInArray("a", [])).toEqual(["a"]);
  });
});

describe("toRecordByProperty", () => {
  const items = [
    { id: "a", value: 1 },
    { id: "b", value: 2 },
  ];

  test("indexes by string property", () => {
    const result = toRecordByProperty(items, "id");
    expect(result).toEqual({
      a: { id: "a", value: 1 },
      b: { id: "b", value: 2 },
    });
  });

  test("indexes by key selector function", () => {
    const result = toRecordByProperty(items, (item) => `item-${item.id}`);
    expect(result["item-a"]).toEqual({ id: "a", value: 1 });
  });

  test("applies key transformer", () => {
    const result = toRecordByProperty(items, "id", (k) => k.toUpperCase());
    expect(result["A"]).toEqual({ id: "a", value: 1 });
  });
});

describe("splitArrayToChunks", () => {
  test("splits into equal chunks", () => {
    const result = splitArrayToChunks([1, 2, 3, 4], 2);
    expect(result).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("last chunk can be smaller", () => {
    const result = splitArrayToChunks([1, 2, 3], 2);
    expect(result).toEqual([[1, 2], [3]]);
  });

  test("empty array returns empty result", () => {
    expect(splitArrayToChunks([], 10)).toEqual([]);
  });

  test("default chunk size is 100", () => {
    // oxlint-disable-next-line beesolve/prefer-props-object
    const data = Array.from({ length: 150 }, (_blank, i) => i);
    const result = splitArrayToChunks(data);
    expect(result.length).toBe(2);
    expect(result[0]?.length).toBe(100);
    expect(result[1]?.length).toBe(50);
  });
});

describe("capitalizeFirstLetter", () => {
  test("capitalizes the first letter", () => {
    expect(capitalizeFirstLetter("hello")).toBe("Hello");
  });

  test("leaves already-capitalized strings unchanged", () => {
    expect(capitalizeFirstLetter("World")).toBe("World");
  });

  test("handles empty string", () => {
    expect(capitalizeFirstLetter("")).toBe("");
  });
});
