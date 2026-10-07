# @beesolve/lambda-keep-active

## 2.1.6

### Patch Changes

- 58111f6: Upgrade dependencies.

  - `dmarc-parser`: bump `fast-xml-parser`, `mailparser`, and `@types/mailparser`.
  - `lambda-keep-active`: bump `@aws-sdk/client-lambda`, `@aws-sdk/client-resource-groups-tagging-api`, and the `aws-cdk-lib` dependency and peer range.
  - `lint-config`: bump `oxlint-plugin-eslint` and raise the `oxfmt`, `oxlint`, and `oxlint-tsgolint` peer ranges to match the toolchain versions used across the monorepo.

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

- Updated dependencies [b9e6f26]
  - @beesolve/cdk-constructs@0.3.2

## 2.1.5

### Patch Changes

- 8b821bc: chore: upgrade dependencies

## 2.1.4

### Patch Changes

- f7e28a0: Update AWS SDK clients (`@aws-sdk/client-lambda`, `@aws-sdk/client-resource-groups-tagging-api`) to ^3.1124.0 and bump `aws-cdk-lib` (dev + peer) to ^2.267.0.

## 2.1.3

### Patch Changes

- Updated dependencies [d54dca7]
  - @beesolve/cdk-constructs@0.3.0

## 2.1.2

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects
- Updated dependencies [0615a63]
  - @beesolve/cdk-constructs@0.2.1

## 2.1.1

### Patch Changes

- f9ac4e7: chore: upgrade dependencies

## 2.1.0

### Minor Changes

- 39a97ac: Add `./runtime` export entry point for the `keptActive` wrapper. Upgrade AWS SDK to 3.1080 and aws-cdk-lib to 2.261.

## 2.0.0

### Major Changes

- 5b7d2d3: ditch projen in favour of simplified build which we can control
