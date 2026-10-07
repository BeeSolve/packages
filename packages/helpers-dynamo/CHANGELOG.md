# @beesolve/dynamo-helpers

## 0.2.1

### Patch Changes

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

- Updated dependencies [b9e6f26]
  - @beesolve/helpers@0.2.1

## 0.2.0

### Minor Changes

- b9696d1: Introduce `@beesolve/dynamo-helpers` with shared DynamoDB access utilities.

  - `toDynamoClient()` — a `DynamoDBDocumentClient` with the standard marshall options and an `AWS_PROFILE`-based local credential strategy.
  - `queryAll()` — runs a query to completion, following `LastEvaluatedKey` until exhausted.
  - `batchGet()` — deduplicates keys, splits them into batches of 100, and maps results back to the original keys via a caller-supplied transformer.
