import { generateUrl } from "@beesolve/image-optimizer";
import type { Mutation } from "@beesolve/image-optimizer";

export const testPagesPrefix = "assets/test";

interface TestCase {
  name: string;
  expected: string;
  url: string;
  placeholder?: boolean;
}

interface Section {
  title: string;
  description: string;
  checkerboard?: boolean;
  cases: Array<TestCase>;
}

const photos = ["01.jpeg", "02.jpeg", "03.jpeg", "04.jpeg"];
const width = { type: "fitWidth", width: 400, enlarge: false } as const;

/** HTML pages keyed by file name, deployed under `/assets/test/`. URLs are root-relative. */
export function testPages(): Record<string, string> {
  const pages: Record<string, string> = {};
  photos.forEach((photo, index) => {
    pages[`photo-0${index + 1}.html`] = render({
      title: `Photo ${photo}`,
      sections: [photoSection(photo)],
    });
  });
  pages["animated.html"] = render({ title: "Animated GIF and WebP", sections: animatedSections() });
  pages["alpha.html"] = render({ title: "Transparency", sections: alphaSections() });
  pages["index.html"] = index(Object.keys(pages));
  return pages;
}

function url(props: { path: string; mutations: ReadonlyArray<Mutation> }): string {
  return generateUrl({ baseUrl: "", assetsPathPrefix: "assets", ...props });
}

function photoSection(photo: string): Section {
  const path = `photos/${photo}`;
  const cases: Array<[string, string, ReadonlyArray<Mutation>]> = [
    ["original", "full size, WebP", []],
    ["fitWidth 400, enlarge", "400 wide", [{ type: "fitWidth", width: 400, enlarge: true }]],
    ["fitWidth 400", "400 wide", [width]],
    ["fitHeight 300", "300 high", [{ type: "fitHeight", height: 300, enlarge: false }]],
    [
      "fitBox 400x400",
      "fits inside 400x400, aspect ratio kept",
      [{ type: "fitBox", width: 400, height: 400, enlarge: false }],
    ],
    [
      "fitBox 9000, no enlarge",
      "original size",
      [{ type: "fitBox", width: 8000, height: 8000, enlarge: false }],
    ],
    ["stretch 400x400", "square, visibly skewed", [{ type: "stretch", width: 400, height: 400 }]],
    [
      "stretch 800x200",
      "wide strip, visibly skewed",
      [{ type: "stretch", width: 800, height: 200 }],
    ],
    ["pixelRatio 2", "800 px image shown at 400", [width, { type: "pixelRatio", ratio: 2 }]],
    ["rotate 90", "rotated clockwise", [width, { type: "rotate", degrees: 90 }]],
    ["rotate 180", "upside down", [width, { type: "rotate", degrees: 180 }]],
    ["rotate 270", "rotated counter-clockwise", [width, { type: "rotate", degrees: 270 }]],
    ["flip horizontal", "mirrored left-right", [width, { type: "flip", direction: "horizontal" }]],
    ["flip vertical", "mirrored top-bottom", [width, { type: "flip", direction: "vertical" }]],
    ["flip both", "same as rotate 180", [width, { type: "flip", direction: "both" }]],
    ["toWebp q20", "WebP, visibly soft", [width, { type: "toWebp", quality: 20 }]],
    ["toWebp q95", "WebP, sharp", [width, { type: "toWebp", quality: 95 }]],
    ["toJpeg q10", "JPEG, blocky artefacts", [width, { type: "toJpeg", quality: 10 }]],
    ["toJpeg q90", "JPEG, sharp", [width, { type: "toJpeg", quality: 90 }]],
    ["toPng", "PNG, lossless", [width, { type: "toPng" }]],
    ["auto q40", "WebP in this page", [width, { type: "auto", quality: 40 }]],
    [
      "everything",
      "JPEG, rotated, flipped, 2x",
      [
        { type: "fitBox", width: 300, height: 300, enlarge: false },
        { type: "pixelRatio", ratio: 2 },
        { type: "rotate", degrees: 270 },
        { type: "flip", direction: "vertical" },
        { type: "toJpeg", quality: 60 },
      ],
    ],
  ];
  return {
    title: photo,
    description:
      "Every mutation of generateUrl on a real photo. Compare each image with its expected result.",
    cases: [
      ...cases.map(([name, expected, mutations]) => ({
        name,
        expected,
        url: url({ path, mutations }),
      })),
      {
        name: "placeholder",
        expected: "blurry tiny preview with the same colours",
        url: url({ path, mutations: [width, { type: "placeholder" }] }),
        placeholder: true,
      },
    ],
  };
}

function animatedSections(): Array<Section> {
  const webp = (expected: string, mutations: ReadonlyArray<Mutation>, name: string): TestCase => ({
    name,
    expected,
    url: url({ path: "fixtures/animated-large.webp", mutations }),
  });
  return [
    {
      title: "Animated WebP (.webp, processed by the image function)",
      description:
        "Animated WebP is passed through unchanged, so every variant must still move and stay 640x360. X-Image-Optimizer is passthrough; format=animated-webp.",
      checkerboard: true,
      cases: [
        webp("moving ball, 640x360", [], "original"),
        webp(
          "still moving, not resized",
          [{ type: "fitWidth", width: 200, enlarge: false }],
          "fitWidth 200",
        ),
        webp("still moving WebP", [width, { type: "toJpeg", quality: 80 }], "toJpeg"),
        webp("still moving WebP", [width, { type: "toPng" }], "toPng"),
      ],
    },
    {
      title: "Animated and still GIF (.gif, served from the bucket)",
      description:
        "GIF is served as stored, URL parameters are ignored. Every variant must move (except still.gif) at the original size.",
      checkerboard: true,
      cases: [
        {
          name: "original",
          expected: "moving ball, 640x360",
          url: "/assets/fixtures/animated-large.gif",
        },
        {
          name: "?w=200",
          expected: "unchanged, still moving",
          url: "/assets/fixtures/animated-large.gif?w=200",
        },
        {
          name: "?fm=webp",
          expected: "unchanged GIF",
          url: "/assets/fixtures/animated-large.gif?fm=webp",
        },
        {
          name: "small original",
          expected: "moving ball, 160x120",
          url: "/assets/fixtures/animated-small.gif",
        },
        { name: "still GIF", expected: "one frame", url: "/assets/fixtures/still.gif" },
      ],
    },
  ];
}

function alphaSections(): Array<Section> {
  const sources = [
    { path: "fixtures/alpha.png", title: "PNG with transparency" },
    { path: "fixtures/alpha.webp", title: "WebP with transparency" },
  ];
  return sources.map((source) => ({
    title: source.title,
    description:
      "The checkerboard must show through the background and through the half-transparent stripe. JPEG has no alpha: the transparent area turns into the colour stored under it.",
    checkerboard: true,
    cases: [
      {
        name: "original",
        expected: "checkerboard visible",
        url: url({ path: source.path, mutations: [] }),
      },
      {
        name: "fitWidth 300",
        expected: "checkerboard visible",
        url: url({
          path: source.path,
          mutations: [{ type: "fitWidth", width: 300, enlarge: false }],
        }),
      },
      {
        name: "toWebp",
        expected: "checkerboard visible",
        url: url({
          path: source.path,
          mutations: [{ type: "fitWidth", width: 300, enlarge: false }, { type: "toWebp" }],
        }),
      },
      {
        name: "toPng",
        expected: "checkerboard visible",
        url: url({
          path: source.path,
          mutations: [{ type: "fitWidth", width: 300, enlarge: false }, { type: "toPng" }],
        }),
      },
      {
        name: "toJpeg",
        expected: "no transparency (limitation)",
        url: url({
          path: source.path,
          mutations: [
            { type: "fitWidth", width: 300, enlarge: false },
            { type: "toJpeg", quality: 85 },
          ],
        }),
      },
      {
        name: "rotate 90",
        expected: "checkerboard visible, rotated",
        url: url({
          path: source.path,
          mutations: [
            { type: "fitWidth", width: 300, enlarge: false },
            { type: "rotate", degrees: 90 },
          ],
        }),
      },
    ],
  }));
}

interface RenderProps {
  title: string;
  sections: Array<Section>;
}

function render(props: RenderProps): string {
  const sections = props.sections.map((section) => {
    const cards = section.cases.map((testCase) => {
      const image = testCase.placeholder
        ? `<img data-placeholder="${escape(testCase.url)}" alt="">`
        : `<img src="${escape(testCase.url)}" loading="lazy" alt="">`;
      return `<figure>${image}<figcaption><b>${escape(testCase.name)}</b><br>Expected: ${escape(testCase.expected)}<br><a href="${escape(testCase.url)}">${escape(testCase.url)}</a><br><span class="meta" data-for="${escape(testCase.url)}"></span></figcaption></figure>`;
    });
    return `<section${section.checkerboard ? ' class="checkerboard"' : ""}><h2>${escape(section.title)}</h2><p>${escape(section.description)}</p><div class="grid">${cards.join("")}</div></section>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>${escape(props.title)} - image optimizer</title>
<style>
body{font:14px system-ui;margin:16px;max-width:1400px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
img{max-width:100%;display:block}
.checkerboard img{background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/16px 16px}
figure{margin:0}
figcaption{margin-top:4px;word-break:break-all}
.meta{color:#555}
</style>
<p><a href="index.html">All test pages</a></p>
<h1>${escape(props.title)}</h1>
<p>Images load through &lt;img&gt;, so the browser asks for WebP. The line under each link shows the Content-Type, size and X-Image-Optimizer header of the response.</p>
${sections.join("\n")}
<script>
document.querySelectorAll("img[data-placeholder]").forEach(async (img) => {
  img.src = await (await fetch(img.dataset.placeholder)).text();
  img.style.width = "320px";
});
document.querySelectorAll(".meta").forEach(async (meta) => {
  const response = await fetch(meta.dataset.for, { headers: { accept: "image/webp,image/*,*/*" } });
  const size = (await response.arrayBuffer()).byteLength;
  meta.textContent = response.status + " " + response.headers.get("content-type") + ", " + Math.round(size / 1024) + " KB, " + (response.headers.get("x-image-optimizer") ?? "served from the bucket");
});
</script>`;
}

function index(pages: Array<string>): string {
  const links = pages
    .map((page) => `<li><a href="${page}">${page.replace(".html", "")}</a></li>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Image optimizer test pages</title><body style="font:16px system-ui;margin:24px"><h1>Image optimizer test pages</h1><p>Review every page and compare each image with its expected result, then approve the workflow run.</p><ul>${links}</ul></body>`;
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
