# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Almost every `@beesolve/*` package that talks to DynamoDB re-implements the same
low-level access patterns:

- **Client construction** with the same marshalling options
  (`removeUndefinedValues: true`, `convertEmptyValues: false`) and a local-dev
  credential strategy driven by `AWS_PROFILE`.
- **Full pagination** — a single `QueryCommand` only returns up to 1 MB of data
  and a `LastEvaluatedKey`. Callers that want "all matching items" must loop on
  `ExclusiveStartKey`, and most either forget to (silently truncating results)
  or copy the loop into each model.
- **Batch get** — `BatchGetCommand` caps at 100 keys per request, does not
  deduplicate, and returns items in an arbitrary order, so callers must chunk,
  dedupe, and re-associate results back to their keys by hand.

This boilerplate is easy to get subtly wrong (truncated queries, mis-ordered
batch results) and is duplicated across `service-auth`, `dmarc-consumer`,
`action-tokens`, and others.

## Decision

Extract these DynamoDB access helpers into a standalone package,
`@beesolve/dynamo-helpers`, providing:

- **`toDynamoClient()`** — a `DynamoDBDocumentClient` with the standard marshall
  options and the shared `AWS_PROFILE`-based local credential strategy.
- **`queryAll()`** — runs a query to completion, following `LastEvaluatedKey`
  until exhausted, returning every matching item.
- **`batchGet()`** — deduplicates keys, splits them into batches of 100, and maps
  results back to the original keys via a caller-supplied transformer.

## Rationale

### 1. Generic primitive, not domain-specific

Pagination, batching, and client construction are concerns of every
DynamoDB-backed model regardless of domain. Keeping them out of `@beesolve/helpers`
(which is dependency-light and DynamoDB-agnostic) avoids forcing the AWS SDK onto
consumers that only need the pure utilities, while still giving DynamoDB consumers
one tested implementation.

### 2. Correctness is easy to get wrong

A query that does not paginate silently returns partial data once a result set
crosses 1 MB — a bug that only appears in production at scale. Centralizing the
loop in a tested helper removes that failure mode from every call site.

### 3. Consistent client configuration

Marshalling options and the local credential strategy should be identical
everywhere. A single factory prevents drift between packages.

## Consequences

- DynamoDB-backed packages depend on `@beesolve/dynamo-helpers` and drop their
  local copies of these patterns.
- The package pulls in `@aws-sdk/*` clients, so it is heavier than
  `@beesolve/helpers`; consumers that do not use DynamoDB should not depend on it.
- It is DynamoDB-only and not portable to other databases — acceptable given the
  AWS-focused target audience.

## Alternatives Considered

### Add these helpers to `@beesolve/helpers`

Rejected. `@beesolve/helpers` is intentionally dependency-light and
storage-agnostic. Adding the AWS SDK there would burden every consumer of the pure
utilities with DynamoDB client dependencies.

### Leave the patterns inline in each package

Rejected. That is the status quo, and it has already produced duplicated
pagination/batch logic across several packages with the associated risk of
truncated queries and mis-ordered batch results.
