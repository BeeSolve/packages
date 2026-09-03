# ADR-002: Pin the CSS Target So lightningcss Keeps Native `light-dark()`

## Status

Accepted

## Context

The dashboard uses `@drop-in/graffiti` for styling. Graffiti implements light/dark
theming entirely with the CSS `light-dark()` function: its `--fg`, `--bg`, shadow,
and button tokens are defined as `light-dark(<light value>, <dark value>)`, and the
resolved branch is chosen by the element's computed `color-scheme` property.

The dashboard exposes a runtime theme toggle (`themeSwitcher.svelte`) that follows
this model. It stores an explicit `light`/`dark` override in `localStorage` (or none,
to follow the OS) and applies it by setting the `color-scheme` property on the
`<html>` element. A no-flash inline script in `app.html` applies any stored override
before first paint. Because graffiti's tokens use `light-dark()`, flipping
`color-scheme` is all that is needed to re-resolve every color.

This worked in `bun run dev` but not in the deployed production build. In the deployed
app the toggle updated its icon and wrote the correct value to `localStorage`, but the
rendered colors never changed — the page stayed on whatever the OS preferred.

The cause is a build-time CSS transform. Vite 8 uses **lightningcss** as its CSS
transformer. lightningcss lowers modern CSS features it believes the target browsers
do not support. SvelteKit's SSR build defaults `build.cssTarget` to a Node target
(`node18.13`), which lightningcss interprets as an ancient browser set. Under that
target it lowers `light-dark()` into a `prefers-color-scheme` polyfill:

```css
:root {
  --lightningcss-light: initial;
  --lightningcss-dark: ;
}
@media (prefers-color-scheme: dark) {
  :root {
    --lightningcss-light: ;
    --lightningcss-dark: initial;
  }
}
--fg: var(--lightningcss-light, var(--fg-light)) var(--lightningcss-dark, var(--fg-dark));
```

This polyfill switches **only** on the `prefers-color-scheme` media query. It has no
connection to the `color-scheme` property, so setting `color-scheme: light` on `<html>`
at runtime has no effect. In `vite dev` the transform is not applied, so native
`light-dark()` is served and the toggle works — which is why the bug was invisible
locally and only appeared in the deployed build.

## Decision

Pin the CSS transform target for the dashboard to browsers with native `light-dark()`
support (Baseline mid-2024) so lightningcss leaves `light-dark()` intact. In
`vite.config.ts`:

- Set `css.transformer: "lightningcss"` with explicit `css.lightningcss.targets`.
- Set `build.cssMinify: "lightningcss"`.
- Set `build.cssTarget` to the same modern browser set. This is the decisive setting:
  lightningcss derives its lowering from `build.cssTarget`, and leaving it at the
  SvelteKit SSR default (`node18.13`) forces the polyfill regardless of
  `css.lightningcss.targets`.

The target is Chrome/Edge 123, Firefox 120, Safari 17.5 — the point at which
`light-dark()` became broadly available.

## Rationale

### 1. It fixes the actual mechanism, not the symptom

The toggle logic, the no-flash script, and graffiti's CSS were all correct. The only
defect was a build-time transform silently rewriting `light-dark()` into a form that
ignores `color-scheme`. Correcting the target removes the rewrite, so the intended
mechanism works end to end.

### 2. The app already targets modern browsers

Graffiti relies on `light-dark()`, `oklch()`, `color-mix()`, and `oklch(from …)`
relative color syntax. An app built on these features already requires a modern
browser. Pinning the CSS target to Baseline mid-2024 aligns the declared target with
what the app has always in practice required — it does not narrow real support.

### 3. Dev and production now agree

With a modern target, the production CSS matches what `vite dev` serves (native
`light-dark()`). This removes the class of bug where a feature works locally and breaks
only after a build, which is expensive to diagnose.

## Consequences

- lightningcss will no longer downlevel modern CSS for legacy browsers. Any consumer on
  a browser older than the target may see unstyled or mis-resolved colors. This is
  acceptable given the app's existing reliance on modern CSS (see Rationale 2).
- The theming contract is now explicit: the app depends on native `light-dark()` +
  `color-scheme`. Anyone lowering the CSS target in future will reintroduce this bug.
  The `vite.config.ts` comment records why the target is pinned.
- Verification of theme behavior must be done against a **built** artifact, not only
  `vite dev`, because the two pipelines resolve `light-dark()` differently.

## Alternatives Considered

### Drive the lightningcss polyfill variables from the toggle

The toggle could set `--lightningcss-light`/`--lightningcss-dark` directly to force the
polyfill's branch. Rejected: these are transformer-internal implementation details with
no stability guarantee, they differ by lightningcss version, and coupling application
code to them is fragile.

### Stop using `light-dark()` and write explicit theme classes

Replace graffiti's `light-dark()` tokens with an app-level `.theme-light` / `.theme-dark`
class that redefines `--fg`/`--bg`. Rejected: it fights the styling library rather than
using it as designed, duplicates graffiti's palette, and would drift as graffiti evolves.

### Add `<meta name="color-scheme">`

Tested and rejected: a `color-scheme` meta tag does not change how the lowered polyfill
resolves, because the polyfill keys off `prefers-color-scheme`, not `color-scheme`.

### Disable lightningcss / use the esbuild CSS pipeline

Reverting to a non-lightningcss transformer would avoid the lowering, but lightningcss
is the Vite 8 default and provides better minification and modern-CSS handling. Pinning
the target keeps its benefits while fixing the regression.

## References

- Bug report: `docs/bugs/002-cloudfront-module-import-failed.md` (adjacent asset-serving
  investigation from the same deployment).
- lightningcss transpilation and targets: https://lightningcss.dev/transpilation.html
- `vite.config.ts` in this package — the pinned target and an inline explanation.
