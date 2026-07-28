# @beesolve/lint-config

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
