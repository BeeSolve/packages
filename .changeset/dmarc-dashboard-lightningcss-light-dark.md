---
"@beesolve/dmarc-dashboard": patch
---

Fix the theme toggle in the production build. Vite 8 uses lightningcss as its
CSS transformer, and SvelteKit's SSR build defaults `build.cssTarget` to a Node
target, which lightningcss interprets as an ancient browser set and uses to
lower `light-dark()` into a `prefers-color-scheme` polyfill. That polyfill only
tracks the OS preference and ignores the `color-scheme` property, so the toggle
(which flips `color-scheme` on `<html>`) had no visual effect in the deployed
app even though it worked in `vite dev`. Pin the CSS transformer targets and
`build.cssTarget` to browsers with native `light-dark()` support so the built
CSS keeps `light-dark()` intact and the toggle works.
