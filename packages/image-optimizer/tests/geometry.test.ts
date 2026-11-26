import { beforeAll, describe, expect, it } from "bun:test";

import { computeGeometry } from "../src/geometry";
import type { Dimensions } from "../src/geometry";
import { parseParams } from "../src/params";
import { createImage } from "./fixtures";

beforeAll(() => {
  Bun.Image.backend = "bun";
});

interface Row {
  name: string;
  source: Dimensions;
  query: string;
  expected: Dimensions;
  requiredScale: number;
}

const rows: Array<Row> = [
  {
    name: "clip fits inside the box and enlarges",
    source: { width: 100, height: 200 },
    query: "w=300&h=300",
    expected: { width: 150, height: 300 },
    requiredScale: 1.5,
  },
  {
    name: "max fits inside the box and never enlarges",
    source: { width: 100, height: 200 },
    query: "w=300&h=300&fit=max",
    expected: { width: 100, height: 200 },
    requiredScale: 1,
  },
  {
    name: "scale stretches to the box",
    source: { width: 100, height: 200 },
    query: "w=300&h=300&fit=scale",
    expected: { width: 300, height: 300 },
    requiredScale: 3,
  },
  {
    name: "only width derives the height",
    source: { width: 100, height: 200 },
    query: "w=50",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
  {
    name: "only height derives the width",
    source: { width: 100, height: 200 },
    query: "h=100",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
  {
    name: "clip enlarges when only width is given",
    source: { width: 100, height: 200 },
    query: "w=300",
    expected: { width: 300, height: 600 },
    requiredScale: 3,
  },
  {
    name: "max does not enlarge when only width is given",
    source: { width: 100, height: 200 },
    query: "w=300&fit=max",
    expected: { width: 100, height: 200 },
    requiredScale: 1,
  },
  {
    name: "max keeps downscaling when the other side limits",
    source: { width: 100, height: 200 },
    query: "w=300&h=100&fit=max",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
  {
    name: "dpr multiplies the box",
    source: { width: 100, height: 200 },
    query: "w=40&dpr=2",
    expected: { width: 80, height: 160 },
    requiredScale: 0.8,
  },
  {
    name: "dpr with max is capped at the original",
    source: { width: 100, height: 200 },
    query: "w=300&dpr=2&fit=max",
    expected: { width: 100, height: 200 },
    requiredScale: 1,
  },
  {
    name: "fractional dpr rounds the box",
    source: { width: 100, height: 200 },
    query: "w=33&dpr=1.5",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
  {
    name: "rot 90 swaps the source dimensions before resizing",
    source: { width: 100, height: 200 },
    query: "w=100&rot=90",
    expected: { width: 100, height: 50 },
    requiredScale: 0.5,
  },
  {
    name: "rot 180 keeps the source dimensions",
    source: { width: 100, height: 200 },
    query: "w=50&rot=180",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
  {
    name: "flip does not change the dimensions",
    source: { width: 100, height: 200 },
    query: "w=50&flip=h",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
  {
    name: "no size keeps the source",
    source: { width: 100, height: 200 },
    query: "",
    expected: { width: 100, height: 200 },
    requiredScale: 1,
  },
  {
    name: "no size with rot 270 keeps the rotated source",
    source: { width: 100, height: 200 },
    query: "rot=270",
    expected: { width: 200, height: 100 },
    requiredScale: 1,
  },
  {
    name: "derived side is rounded",
    source: { width: 1000, height: 667 },
    query: "w=333",
    expected: { width: 333, height: 222 },
    requiredScale: 0.333,
  },
  {
    name: "inside rounds both sides",
    source: { width: 1000, height: 667 },
    query: "w=500&h=500",
    expected: { width: 500, height: 334 },
    requiredScale: 0.50075,
  },
  {
    name: "extreme aspect keeps at least one pixel",
    source: { width: 4000, height: 3 },
    query: "w=100",
    expected: { width: 100, height: 1 },
    requiredScale: 0.333,
  },
  {
    name: "scale with one side derives the other without skew",
    source: { width: 100, height: 200 },
    query: "w=50&fit=scale",
    expected: { width: 50, height: 100 },
    requiredScale: 0.5,
  },
];

describe("computeGeometry", () => {
  for (const row of rows) {
    it(`${row.name} (${row.query || "no query"})`, async () => {
      const geometry = computeGeometry({ source: row.source, params: parseParams(row.query) });

      expect(geometry.resize).toEqual(row.expected);
      expect(geometry.requiredScale).toBeCloseTo(row.requiredScale, 3);

      const image = new Bun.Image(await createImage({ ...row.source, format: "png" }));
      if (geometry.rotate !== 0) image.rotate(geometry.rotate);
      const output = await image
        .resize(geometry.requested.width, geometry.requested.height, {
          fit: geometry.fit,
          withoutEnlargement: geometry.withoutEnlargement,
        })
        .png()
        .bytes();
      const actual = await new Bun.Image(output).metadata();

      expect({ width: actual.width, height: actual.height }).toEqual(geometry.resize);
    });
  }

  it("passes the flip through", () => {
    const geometry = computeGeometry({
      source: { width: 100, height: 200 },
      params: parseParams("flip=hv&rot=180"),
    });
    expect(geometry.flip).toBe("hv");
    expect(geometry.rotate).toBe(180);
  });

  it("omits the flip when none is requested", () => {
    const geometry = computeGeometry({
      source: { width: 100, height: 200 },
      params: parseParams("w=10"),
    });
    expect("flip" in geometry).toBe(false);
  });

  it("maps fit to the Bun options", () => {
    const source = { width: 100, height: 200 };
    const clip = computeGeometry({ source, params: parseParams("w=10") });
    const max = computeGeometry({ source, params: parseParams("w=10&fit=max") });
    const scale = computeGeometry({ source, params: parseParams("w=10&h=10&fit=scale") });
    expect([clip.fit, clip.withoutEnlargement]).toEqual(["inside", false]);
    expect([max.fit, max.withoutEnlargement]).toEqual(["inside", true]);
    expect([scale.fit, scale.withoutEnlargement]).toEqual(["fill", false]);
  });
});
