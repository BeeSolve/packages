# ADR-003: Run tests per package, not in one shared process

## Status

Accepted

## Context

The root test script runs one `bun test` process per workspace package via
`--filter`:

```jsonc
"test": "bun run build && bun run --filter '*' test"
```

It is tempting to run a single `bun test` from the repo root instead, because
Bun will happily discover and execute every `*.test.ts` across all packages in
one process. That shortcut does not behave the same way.

Several test files replace modules with `mock.module(...)` (for example the SES
document client, the DynamoDB document client, and other SDK singletons). Bun's
module mocks and other process-global state (mocked timers, `process.env`
mutations, registered module overrides) are **process-wide and persist across
files** within a single `bun test` invocation. When the whole workspace runs in
one process, a mock installed by one package's test leaks into an unrelated
package's test that loads the same module later in the run. The result is a
small number of failures/errors (observed as `1 fail` + `1 error`) that appear
only in the aggregate single-process run and **cannot be reproduced** by running
any individual package's suite on its own.

Running each package in its own `bun test` process gives every package a fresh
module registry and clean globals, so mocks are scoped to the package that
installs them.

## Decision

Tests are always run per package, each in its own `bun test` process. The
supported commands are:

- Whole workspace: `bun run test` (which expands to
  `bun run --filter '*' test`, one process per package).
- A single package: `cd packages/<name> && bun test`.

Do **not** run a bare `bun test` from the repository root to validate the
workspace. It shares one process across all packages and produces spurious
cross-package failures. A green result from the per-package commands above is
the source of truth.

## Rationale

### 1. Test isolation is a per-process guarantee in Bun

`mock.module` and friends mutate the running process. Bun does not reset the
module registry between files in one invocation, so isolation between packages
is only guaranteed by using separate processes. The `--filter '*'` fan-out is
that isolation boundary.

### 2. It matches how packages are built and published

Packages are already built and versioned independently (see ADR-001, ADR-002).
Testing them independently is consistent with that boundary and keeps one
package's test setup from silently depending on another's.

### 3. No new tooling

The behavior is already encoded in the root `test` script. This ADR documents
the constraint so the single-process shortcut is not mistaken for an equivalent
way to run the suite.

## Consequences

Positive:

- Deterministic results: no cross-package mock leakage.
- Failures reproduce in the owning package, making them debuggable.
- Consistent with the independent build/publish model.

Negative / trade-offs accepted:

- Slightly more process startup overhead than a single shared process.
- Contributors must know not to run a bare root `bun test`; this ADR and a note
  in `docs/adding-a-package.md` exist to make that explicit.

## Alternatives Considered

### Run one shared `bun test` from the root

Simplest to type, and fastest in raw process terms. Rejected: it does not
isolate module mocks, so it reports failures that do not exist under the
supported per-package runs and hides which package owns a real failure.

### Make every test self-clean its mocks

Require each test to `mock.restore()` / reset all globals in `afterEach`/
`afterAll` so a shared process stays clean. Rejected as the primary mechanism:
it is easy to forget, hard to enforce, and one missed restore reintroduces the
flake. Per-process isolation is robust by construction. (Good hygiene around
restoring mocks is still encouraged, but it is not what the suite relies on.)

## References

- ADR-001: Test built artifacts (build before test)
- ADR-002: bunup workspace build determinism
- `docs/adding-a-package.md`
