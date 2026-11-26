import { describe, expect, it } from "bun:test";

import { imageLimits } from "../src/limits";
import { canonicalizeQuery } from "../src/query";
import { generateUrl } from "../src/url";
import type { Mutation } from "../src/url";

const baseUrl = "https://example.com";
const assetsPathPrefix = "assets";
const path = "photos/cat.jpg";
const root = "https://example.com/assets/photos/cat.jpg";

function url(mutations: ReadonlyArray<Mutation>): string {
  return generateUrl({ baseUrl, path, assetsPathPrefix, mutations });
}

describe("generateUrl mutations", () => {
  it("returns the plain URL for no mutations", () => {
    expect(url([])).toBe(root);
  });

  it("fits inside a box and decides about enlarging explicitly", () => {
    expect(url([{ type: "fitBox", width: 300, height: 300, enlarge: false }])).toBe(
      `${root}?fit=max&h=300&w=300`,
    );
    expect(url([{ type: "fitBox", width: 300, height: 300, enlarge: true }])).toBe(
      `${root}?h=300&w=300`,
    );
  });

  it("fits by width or by height", () => {
    expect(url([{ type: "fitWidth", width: 400, enlarge: true }])).toBe(`${root}?w=400`);
    expect(url([{ type: "fitHeight", height: 300, enlarge: false }])).toBe(`${root}?fit=max&h=300`);
  });

  it("stretches to an exact size", () => {
    expect(url([{ type: "stretch", width: 300, height: 200 }])).toBe(
      `${root}?fit=scale&h=200&w=300`,
    );
  });

  it("applies a pixel ratio to the size", () => {
    expect(
      url([
        { type: "fitWidth", width: 300, enlarge: false },
        { type: "pixelRatio", ratio: 2 },
      ]),
    ).toBe(`${root}?dpr=2&fit=max&w=300`);
    expect(
      url([
        { type: "fitWidth", width: 300, enlarge: true },
        { type: "pixelRatio", ratio: 1 },
      ]),
    ).toBe(`${root}?w=300`);
  });

  it("uses the default quality when none is given", () => {
    expect(url([{ type: "toWebp" }])).toBe(`${root}?fm=webp`);
    expect(url([{ type: "toJpeg" }])).toBe(`${root}?fm=jpg`);
    expect(url([{ type: "toWebp", quality: imageLimits.defaultQuality }])).toBe(
      url([{ type: "toWebp" }]),
    );
  });

  it("never renders default values into the URL", () => {
    const withDefaults = url([
      { type: "fitWidth", width: 300, enlarge: true },
      { type: "pixelRatio", ratio: 1 },
      { type: "auto", quality: imageLimits.defaultQuality },
    ]);
    expect(withDefaults).toBe(`${root}?w=300`);
    for (const rendered of ["q=75", "fit=clip", "dpr=1", "rot=0", "placeholder=0"]) {
      expect(withDefaults).not.toContain(rendered);
    }
  });

  it("selects the output", () => {
    expect(url([{ type: "toWebp", quality: 80 }])).toBe(`${root}?fm=webp&q=80`);
    expect(url([{ type: "toJpeg", quality: 60 }])).toBe(`${root}?fm=jpg&q=60`);
    expect(url([{ type: "toPng" }])).toBe(`${root}?fm=png`);
    expect(url([{ type: "auto", quality: 90 }])).toBe(`${root}?q=90`);
    expect(url([{ type: "auto", quality: 75 }])).toBe(root);
    expect(url([{ type: "auto" }])).toBe(root);
    expect(url([{ type: "placeholder" }])).toBe(`${root}?placeholder=1`);
  });

  it("rotates and flips", () => {
    expect(
      url([
        { type: "rotate", degrees: 90 },
        { type: "flip", direction: "both" },
      ]),
    ).toBe(`${root}?flip=hv&rot=90`);
    expect(url([{ type: "flip", direction: "horizontal" }])).toBe(`${root}?flip=h`);
    expect(url([{ type: "flip", direction: "vertical" }])).toBe(`${root}?flip=v`);
  });

  it("combines one mutation of each group", () => {
    expect(
      url([
        { type: "toJpeg", quality: 60 },
        { type: "flip", direction: "vertical" },
        { type: "pixelRatio", ratio: 2 },
        { type: "rotate", degrees: 270 },
        { type: "fitBox", width: 400, height: 300, enlarge: false },
      ]),
    ).toBe(`${root}?dpr=2&fit=max&flip=v&fm=jpg&h=300&q=60&rot=270&w=400`);
  });

  it("combines a placeholder with size, rotation and flip", () => {
    expect(
      url([
        { type: "placeholder" },
        { type: "fitWidth", width: 32, enlarge: false },
        { type: "rotate", degrees: 90 },
      ]),
    ).toBe(`${root}?fit=max&placeholder=1&rot=90&w=32`);
  });

  it("is independent of mutation order", () => {
    const first = url([
      { type: "flip", direction: "horizontal" },
      { type: "fitBox", width: 20, height: 10, enlarge: false },
    ]);
    const second = url([
      { type: "fitBox", width: 20, height: 10, enlarge: false },
      { type: "flip", direction: "horizontal" },
    ]);
    expect(first).toBe(second);
  });

  it("generates query strings that are unchanged by canonicalization", () => {
    const urls = [
      url([{ type: "fitBox", width: 300, height: 200, enlarge: false }]),
      url([
        { type: "fitWidth", width: 300, enlarge: true },
        { type: "pixelRatio", ratio: 2.5 },
        { type: "toWebp", quality: 90 },
        { type: "flip", direction: "horizontal" },
      ]),
      url([
        { type: "rotate", degrees: 270 },
        { type: "placeholder" },
        { type: "stretch", width: 32, height: 32 },
      ]),
      url([{ type: "fitHeight", height: 1, enlarge: true }]),
    ];
    for (const generated of urls) {
      const query = generated.includes("?") ? generated.slice(generated.indexOf("?") + 1) : "";
      expect(canonicalizeQuery(query)).toEqual({ query });
    }
  });
});

describe("generateUrl validation", () => {
  it("rejects two mutations of the same group and names both", () => {
    expect(() =>
      url([
        { type: "fitWidth", width: 100, enlarge: true },
        { type: "stretch", width: 100, height: 100 },
      ]),
    ).toThrow('"fitWidth" and "stretch" both set the size');
    expect(() => url([{ type: "toWebp", quality: 80 }, { type: "toPng" }])).toThrow(
      '"toWebp" and "toPng" both set the output',
    );
    expect(() => url([{ type: "toWebp", quality: 80 }, { type: "placeholder" }])).toThrow(
      '"toWebp" and "placeholder" both set the output',
    );
    expect(() =>
      url([
        { type: "rotate", degrees: 90 },
        { type: "rotate", degrees: 180 },
      ]),
    ).toThrow('"rotate" and "rotate" both set the rotation');
  });

  it("requires a size for a pixel ratio", () => {
    expect(() => url([{ type: "pixelRatio", ratio: 2 }])).toThrow("needs a size mutation");
  });

  it("names the failing field for out-of-range values", () => {
    const cases: Array<[Mutation, string]> = [
      [{ type: "fitBox", width: 0, height: 10, enlarge: true }, "fitBox.width"],
      [
        { type: "fitBox", width: 10, height: imageLimits.maxDimension + 1, enlarge: true },
        "fitBox.height",
      ],
      [{ type: "fitWidth", width: 300.5, enlarge: true }, "fitWidth.width"],
      [{ type: "fitHeight", height: Number.NaN, enlarge: true }, "fitHeight.height"],
      [{ type: "stretch", width: -1, height: 10 }, "stretch.width"],
      [{ type: "toWebp", quality: 0 }, "toWebp.quality"],
      [{ type: "toJpeg", quality: 101 }, "toJpeg.quality"],
      [{ type: "auto", quality: 50.5 }, "auto.quality"],
    ];
    for (const [mutation, field] of cases) {
      expect(() => url([mutation])).toThrow(field);
    }
    expect(() =>
      url([
        { type: "fitWidth", width: 10, enlarge: true },
        { type: "pixelRatio", ratio: 4 },
      ]),
    ).toThrow("pixelRatio.ratio");
  });

  it("accepts the limits", () => {
    expect(
      url([
        { type: "fitWidth", width: imageLimits.maxDimension, enlarge: true },
        { type: "pixelRatio", ratio: imageLimits.maxDpr },
        { type: "toJpeg", quality: imageLimits.maxQuality },
      ]),
    ).toBe(`${root}?dpr=3&fm=jpg&q=100&w=8192`);
  });
});

describe("generateUrl compile-time contract", () => {
  it("rejects invalid mutations at the type level", () => {
    const attempts: Array<() => string> = [
      // @ts-expect-error enlarge must be decided
      () => url([{ type: "fitBox", width: 100, height: 100 }]),
      // @ts-expect-error stretch needs both dimensions
      () => url([{ type: "stretch", width: 100 }]),
      // @ts-expect-error png has no quality
      () => url([{ type: "toPng", quality: 80 }]),
      // @ts-expect-error quality must be a number
      () => url([{ type: "toWebp", quality: "high" }]),
      // @ts-expect-error avif is not available
      () => url([{ type: "toAvif", quality: 50 }]),
      // @ts-expect-error rotating by 0 is not a mutation
      () => url([{ type: "rotate", degrees: 0 }]),
      // @ts-expect-error only quarter turns
      () => url([{ type: "rotate", degrees: 45 }]),
      // @ts-expect-error unknown direction
      () => url([{ type: "flip", direction: "x" }]),
      // @ts-expect-error crop is not supported
      () => url([{ type: "crop", position: "faces" }]),
      // @ts-expect-error mutations are required
      () => generateUrl({ baseUrl, path, assetsPathPrefix }),
    ];
    expect(attempts).toHaveLength(10);
  });
});

describe("generateUrl path", () => {
  function plain(overrides: {
    baseUrl?: string;
    path?: string;
    assetsPathPrefix?: string;
  }): string {
    return generateUrl({ baseUrl, path, assetsPathPrefix, mutations: [], ...overrides });
  }

  it("encodes path segments and keeps separators", () => {
    expect(plain({ path: "my photos/ľščťž/cat #1.jpg" })).toBe(
      "https://example.com/assets/my%20photos/%C4%BE%C5%A1%C4%8D%C5%A5%C5%BE/cat%20%231.jpg",
    );
    expect(plain({ path: "a?b=c.jpg" })).toBe("https://example.com/assets/a%3Fb%3Dc.jpg");
  });

  it("normalizes leading and trailing slashes", () => {
    expect(plain({ baseUrl: "https://example.com///", path: "/photos/cat.jpg/" })).toBe(root);
  });

  it("supports a custom assets path prefix", () => {
    expect(plain({ path: "a.jpg", assetsPathPrefix: "/img/" })).toBe(
      "https://example.com/img/a.jpg",
    );
    expect(plain({ path: "a.jpg", assetsPathPrefix: "static/images" })).toBe(
      "https://example.com/static/images/a.jpg",
    );
    expect(plain({ path: "a.jpg", assetsPathPrefix: "" })).toBe("https://example.com/a.jpg");
  });

  it("produces a root-relative URL for an empty base URL", () => {
    expect(
      generateUrl({
        baseUrl: "",
        path: "a.jpg",
        assetsPathPrefix,
        mutations: [{ type: "fitWidth", width: 100, enlarge: true }],
      }),
    ).toBe("/assets/a.jpg?w=100");
  });

  it("rejects empty paths, empty segments and traversal", () => {
    expect(() => plain({ path: "" })).toThrow("empty");
    expect(() => plain({ path: "/" })).toThrow("empty");
    expect(() => plain({ path: "a//b.jpg" })).toThrow("empty segments");
    expect(() => plain({ path: "../secret.jpg" })).toThrow("..");
    expect(() => plain({ path: "a/./b.jpg" })).toThrow(".");
    expect(() => plain({ path: "a.jpg", assetsPathPrefix: "../x" })).toThrow("..");
  });
});
