# @beesolve/dynamo-helpers

## 0.2.0

### Minor Changes

- b9696d1: Introduce `@beesolve/dynamo-helpers` with shared DynamoDB access utilities.

  - `toDynamoClient()` — a `DynamoDBDocumentClient` with the standard marshall options and an `AWS_PROFILE`-based local credential strategy.
  - `queryAll()` — runs a query to completion, following `LastEvaluatedKey` until exhausted.
  - `batchGet()` — deduplicates keys, splits them into batches of 100, and maps results back to the original keys via a caller-supplied transformer.
