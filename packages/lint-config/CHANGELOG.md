# @beesolve/lint-config

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
