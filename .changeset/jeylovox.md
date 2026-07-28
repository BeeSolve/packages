---
"@beesolve/lint-config": minor
---

Enable type-aware linting with oxlint-tsgolint@7

- Add `oxlint-tsgolint` as optional peer dependency
- Enable `options.typeAware: true` in base preset
- Add type-aware rules: no-floating-promises, no-misused-promises, await-thenable, return-await (in-try-catch), no-unnecessary-type-assertion, only-throw-error, prefer-promise-reject-errors, no-deprecated, restrict-template-expressions, no-base-to-string, no-unsafe-type-assertion
- Keep `beesolve/naming-conventions` (native `typescript/naming-convention` not yet available in oxlint)
