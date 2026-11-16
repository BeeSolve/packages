# ADR-001: Why This Package Exists

## Status

Accepted

## Context

BeeSolve projects (library packages, app monorepos, SvelteKit apps) follow the same
code conventions: `import type` for types, no enums, no `switch`, `Array<T>` instead
of `T[]`, a single props-object parameter per function, `import * as v from "valibot"`,
no `.then()` chains, and a common formatter setup. Some of these conventions have no
equivalent in Oxlint's built-in rules and need custom rules.

Without a shared definition, each repository would copy its own `.oxlintrc.json`,
`.oxfmtrc.json`, `.nano-staged.json`, and custom rule code. The copies would drift
and every new rule would have to be ported by hand.

## Decision

Publish `@beesolve/lint-config` as a standalone package that contains:

- A base Oxlint configuration plus presets for `package`, `monorepo`, and `sveltekit`
  projects, each setting the matching `internalPattern` for import grouping
- A custom Oxlint JS plugin (`plugins/beesolve.js`) with the `beesolve/*` rules
- A `setup` script (`bunx @beesolve/lint-config setup`) that generates the project
  configuration files (Oxlint, `bun fmt`, nano-staged and husky)

Consumers extend a preset and override individual rules locally.

## Rationale

### 1. Conventions defined once

Rules and presets live in one place. A convention change is a package release that
projects pick up by upgrading.

### 2. Custom rules need a plugin anyway

Rules such as `prefer-props-object` and `valibot-namespace-import` cannot be
expressed as configuration. They run in Oxlint's JS plugin runtime, which is a
code artifact that has to be distributed, not a config snippet.

### 3. Presets keep per-project differences small

Project types share a base and differ only in ignore patterns and
`internalPattern`. Projects can still turn off a rule or add their own plugin.

## Consequences

- Projects get consistent linting and formatting from a single dependency and one
  setup command.
- Oxlint and `oxlint-tsgolint` are optional peer dependencies. Consumers install
  and pin them themselves.
- Conventions that cannot be enforced by a rule (for example `localeCompare` for
  ISO date strings) are documented in the README and left to code review.
- The package encodes BeeSolve's opinions. It is not a general-purpose lint
  config.

## Alternatives Considered

### Copy configuration into each repository

Rejected. Copies drift, and custom rule code would be duplicated with them.

### Use an existing shared ESLint or Oxlint config

Rejected. Existing public configs do not provide the custom `beesolve/*` rules or
the project-type presets.

### Document the conventions only

Rejected. Conventions that are not enforced by tooling depend on code review to
be applied consistently.
