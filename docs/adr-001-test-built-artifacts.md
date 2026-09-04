# ADR-001: Test built artifacts (build before test)

## Status

Accepted

## Context

Tests in this monorepo import the package under test from source (e.g.
`import { handler } from "../src/consumer.ts"`). However, when a source file
imports a **sibling workspace package** (e.g. `@beesolve/dmarc-consumer`
importing `@beesolve/dmarc-reports`), Bun resolves that import through the
dependency's `package.json` `exports` map, which points at `./dist/*.js`.

This produced two failure modes when tests were run without a prior build:

1. **Module not found** — `Cannot find module '@beesolve/dmarc-reports'`, because
   its `dist/` had not been built yet.
2. **CJS/ESM interop error** — `SyntaxError: Export named 'BatchGetCommand' not
found in @aws-sdk/lib-dynamodb/.../dist-cjs/index.js`, a symptom that only
   appears through the bundled artifact.

Several packages also ship **prebuilt Lambda handlers** as physical assets
(`dist/handler.zip`, `dist/consumer/`, etc.) that CDK constructs reference via
`Code.fromAsset(...)` using paths derived from `import.meta.url`. CDK asset
synthesis (`Template.fromStack`) requires those files to exist on disk.

The result was an implicit, undocumented dependency: the test suite only passes
after a successful `bun run build`, and this ordering was not enforced.

## Decision

Tests run against **built artifacts**. The root `test` script builds first:

```jsonc
"test": "bun run build && bun run --filter '*' test"
```

We test what we ship — the `dist` output, the `exports` map as consumers resolve
it, the bundler's CJS/ESM interop, and the prebuilt Lambda asset layout.

## Rationale

### 1. It catches a class of bugs source-only tests cannot

The `BatchGetCommand` interop error and the `LambdaKeepActive` asset-path
behavior are properties of the **bundled artifact**, not the source. Testing
source would hide them. Building before test surfaces them in CI.

### 2. It requires no special plumbing

Prebuilt-handler packages (e.g. `@beesolve/lambda-keep-active`) resolve their
Lambda asset relative to their built location. Testing the built output means
these constructs "just work" with no per-package special-casing in tests. A
source-first approach would require bespoke handling for every prebuilt handler,
which we explicitly want to avoid.

### 3. The build is already deterministic and required

CI already runs `bun run build` before `type-check`. Building before test adds
no new tooling, only ordering. (See ADR-002 for the build determinism fix that
makes this reliable.)

## Consequences

Positive:

- Tests exercise the same artifacts consumers install.
- No implicit build-ordering footgun; the ordering is encoded in the script.
- No special-case plumbing for prebuilt Lambda handlers.

Negative / trade-offs accepted:

- The inner test loop pays the build cost. A full `bun run build` runs before
  the suite, which is slower than testing source directly.
- Iterating on a single package's tests still triggers a workspace build via the
  root script (individual `packages/*` still expose `bun test` directly for
  ad-hoc runs, but those carry the build-ordering caveat above).

## Alternatives Considered

### Source-only tests via a `"bun"` export condition

Add a `"bun": "./index.ts"` condition to every package's `exports` so Bun
resolves workspace dependencies to TypeScript source. This makes logic tests
fast and build-free, and sidesteps the CJS/ESM interop symptom.

Rejected for now because it does not handle packages that ship **prebuilt
physical assets**: under source resolution, `LambdaKeepActive` computes its zip
path from `import.meta.url` and looks in the package root instead of `dist/`,
so CDK synth fails with `CannotFindAsset`. Making it work would require
special-casing those constructs — exactly the plumbing we want to avoid.

The export-condition itself is considered acceptable; a future "quick,
source-only unit test" layer may adopt it **in addition to** (not instead of)
the built-artifact suite, once the prebuilt-asset handling is researched and
designed so it needs no special cases. Deferred rather than rejected outright.

### Complete the test mocks so no build is needed

The `BatchGetCommand` error partly stems from an incomplete `mock.module` in
`dmarc-consumer/tests/consumer.test.ts`. Completing the mock would paper over the
missing-artifact issue but would not address the module-not-found or the
prebuilt-asset problems, so it does not solve the general case.

## References

- ADR-002: bunup workspace build determinism (`clean` race fix)
- `docs/adding-a-package.md`
