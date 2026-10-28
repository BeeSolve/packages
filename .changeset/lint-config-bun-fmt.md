---
"@beesolve/lint-config": minor
---

Replace oxfmt with `bun fmt` for formatting (Bun 1.4.4+).

- Dropped the optional `oxfmt` peer dependency. `bun fmt` is built into Bun and
  reads the same config natively.
- Renamed the shipped formatter config and its export from `oxfmt.json` /
  `./oxfmt.json` to `.oxfmtrc.json` / `./.oxfmtrc.json`, the name `bun fmt`
  discovers automatically.
- `setup.ts` now generates `bun fmt` scripts and a `bun fmt --no-script`
  nano-staged entry instead of `oxfmt`.

Breaking: consumers that imported `@beesolve/lint-config/oxfmt.json` must switch
to `@beesolve/lint-config/.oxfmtrc.json`, and should remove `oxfmt` from their
dev dependencies and update their `fmt`/`fmt:check` scripts to `bun fmt
--no-script` (see the README quick setup). Requires Bun 1.4.4 or newer.
