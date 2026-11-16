import { describe, expect, it } from "bun:test";

import { toArrayBuffer } from "../src/byteArray";

describe("toArrayBuffer", () => {
  it("returns only the view bytes for a view with a non-zero byteOffset", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9]);
    const view = new Uint8Array(backing.buffer, 2, 4);

    const result = toArrayBuffer(view);

    expect(result.byteLength).toBe(4);
    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4]);
  });

  it("returns all bytes for a zero-offset view covering the whole buffer", () => {
    const view = new Uint8Array([5, 6, 7]);

    const result = toArrayBuffer(view);

    expect(result.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(result))).toEqual([5, 6, 7]);
  });

  it("returns only the view bytes for a zero-offset view shorter than the buffer", () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = new Uint8Array(backing.buffer, 0, 2);

    const result = toArrayBuffer(view);

    expect(result.byteLength).toBe(2);
    expect(Array.from(new Uint8Array(result))).toEqual([1, 2]);
  });

  it("returns a copy that does not alias the original buffer", () => {
    const view = new Uint8Array([1, 2, 3]);

    const result = toArrayBuffer(view);
    view[0] = 99;

    expect(new Uint8Array(result)[0]).toBe(1);
  });
});
