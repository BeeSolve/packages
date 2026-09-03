import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// Vite 8 uses lightningcss as its default CSS transformer. Without an explicit
// target, lightningcss lowers modern CSS — including `light-dark()`, which
// graffiti relies on for theming — into a `prefers-color-scheme` media-query
// polyfill (`--lightningcss-light`/`--lightningcss-dark`). That polyfill only
// tracks the OS preference and ignores the `color-scheme` property, so the
// runtime theme toggle (which flips `color-scheme` on <html>) has no effect in
// the built app even though it works in `vite dev` where the transform is not
// applied. Pin the CSS target to browsers with native `light-dark()` support
// (Baseline mid-2024) so lightningcss leaves it intact.
// lightningcss version encoding: (major << 16) | (minor << 8) | patch.
const cssTargets = {
  chrome: 123 << 16,
  edge: 123 << 16,
  firefox: 120 << 16,
  safari: (17 << 16) | (5 << 8),
};

export default defineConfig({
  plugins: [sveltekit()],
  css: {
    transformer: "lightningcss",
    lightningcss: {
      targets: cssTargets,
    },
  },
  build: {
    cssMinify: "lightningcss",
    // SvelteKit's SSR build defaults `cssTarget` to a Node target ("node18.13"),
    // which lightningcss reads as an ancient browser set and uses to lower
    // `light-dark()` into the prefers-color-scheme polyfill — regardless of
    // `css.lightningcss.targets`. Pin a modern browser cssTarget so the two
    // agree and `light-dark()` survives.
    cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"],
  },
  ssr: {
    external: ["@beesolve/lambda-fetch-api"],
  },
});
