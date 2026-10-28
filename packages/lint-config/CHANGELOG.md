# @beesolve/lint-config

## 0.4.0

### Minor Changes

- f461c31: Replace oxfmt with `bun fmt` for formatting (Bun 1.4.4+).

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

## 0.3.5

### Patch Changes

- 010a478: Add a pre-1.0 stability banner to the README. The package is `0.x` and under
  active development, so breaking changes can land in any `0.x` release without a
  major version bump. The banner is removed when the package reaches `1.0.0`.

## 0.3.4

### Patch Changes

- b80dac0: Update the `oxlint-tsgolint` peer dependency to `>=7.0.2004`.

## 0.3.3

### Patch Changes

- 58111f6: Upgrade dependencies.

  - `dmarc-parser`: bump `fast-xml-parser`, `mailparser`, and `@types/mailparser`.
  - `lambda-keep-active`: bump `@aws-sdk/client-lambda`, `@aws-sdk/client-resource-groups-tagging-api`, and the `aws-cdk-lib` dependency and peer range.
  - `lint-config`: bump `oxlint-plugin-eslint` and raise the `oxfmt`, `oxlint`, and `oxlint-tsgolint` peer ranges to match the toolchain versions used across the monorepo.

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

## 0.3.2

### Patch Changes

- 8b821bc: chore: upgrade dependencies

## 0.3.1

### Patch Changes

- f7e28a0: Update `oxlint-plugin-eslint` to ^1.81.0 and raise `oxfmt` (>=0.66.0) and `oxlint` (>=1.81.0) peer dependency ranges.

## 0.3.0

### Minor Changes

- 834140e: Enable type-aware linting with oxlint-tsgolint@7

  - Add `oxlint-tsgolint` as optional peer dependency
  - Enable `options.typeAware: true` in base preset
  - Add type-aware rules: no-floating-promises, no-misused-promises, await-thenable, return-await (in-try-catch), no-unnecessary-type-assertion, only-throw-error, prefer-promise-reject-errors, no-deprecated, restrict-template-expressions, no-base-to-string, no-unsafe-type-assertion
  - Keep `beesolve/naming-conventions` (native `typescript/naming-convention` not yet available in oxlint)

## 0.2.6

### Patch Changes

- f9ac4e7: chore: upgrade dependencies

## 0.2.5

### Patch Changes

- 39a97ac: Upgrade oxlint-plugin-eslint from 1.72 to 1.73.

## 0.2.4

### Patch Changes

- 5b7d2d3: upgrade dependencies

## 0.2.3

### Patch Changes

- 6c16d1f: upgrade dependencies

## 0.2.2

### Patch Changes

- 98b42fd: turn off ambiguos tests

## 0.2.1

### Patch Changes

- 302955a: Add auto-fixer to `readonly-props` rule (inserts `readonly` keyword automatically with `--fix`)

## 0.2.0

### Minor Changes

- 674f340: Add `no-then-chains` and `readonly-props` custom lint rules. Update preset documentation with per-project configuration examples.
