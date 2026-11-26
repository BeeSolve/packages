# How to: Build image URLs with typed mutations

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/imageOptimizer

## Prerequisites

- An `ImageOptimizer` distribution, see [Getting Started](./getting-started.md)

## Steps

### 1. Install

```sh
bun add @beesolve/image-optimizer
```

`@beesolve/image-optimizer` has no dependencies, so it can run in the browser.

### 2. Generate a URL

```ts
import { generateUrl } from "@beesolve/image-optimizer";

const url = generateUrl({
  baseUrl: "https://cdn.example.com",
  assetsPathPrefix: "assets",
  path: "photos/cat.jpg",
  mutations: [
    { type: "fitBox", width: 400, height: 300, enlarge: false },
    { type: "toWebp", quality: 80 },
  ],
});
// https://cdn.example.com/assets/photos/cat.jpg?fit=max&fm=webp&h=300&q=80&w=400
```

Pass `mutations: []` for the original. Use at most one mutation of each group: size (`fitBox`, `fitWidth`, `fitHeight`, `stretch`), `pixelRatio`, `rotate`, `flip`, and output (`toWebp`, `toJpeg`, `toPng`, `auto`, `placeholder`). `auto` serves WebP to browsers that accept it.

### 3. Build a `srcset`

```ts
import { generateUrl } from "@beesolve/image-optimizer";
import type { Mutation } from "@beesolve/image-optimizer";

const widths = [400, 800, 1200];

export function srcset(path: string, output: Mutation): string {
  return widths
    .map((width) => {
      const url = generateUrl({
        baseUrl: "https://cdn.example.com",
        assetsPathPrefix: "assets",
        path,
        mutations: [{ type: "fitWidth", width, enlarge: false }, output],
      });
      return `${url} ${width}w`;
    })
    .join(", ");
}
```

Prefer widths at or below the construct's size buckets (500, 1000, 1500, ...) so different widths share intermediate copies.

### 4. Inline a placeholder at render time

```ts
const placeholderUrl = generateUrl({
  baseUrl: "https://cdn.example.com",
  assetsPathPrefix: "assets",
  path: "photos/cat.jpg",
  mutations: [{ type: "fitWidth", width: 400, enlarge: false }, { type: "placeholder" }],
});
const dataUrl = await (await fetch(placeholderUrl)).text();
```

Use `dataUrl` as the `src` or background of the image until the real image has loaded.

## Common Pitfalls

- **Two mutations of one group throw.** `"toWebp" and "placeholder" both set the output, use only one of them`.
- **`pixelRatio` needs a size mutation.** Without one it throws.
- **`path` is relative to the prefix.** Pass `photos/cat.jpg`, not `assets/photos/cat.jpg`.
- **`.` and `..` segments throw.** The path is never normalized silently.

## See Also

- [Getting Started](./getting-started.md)
- [README](../../README.md) - the URL parameters behind each mutation
