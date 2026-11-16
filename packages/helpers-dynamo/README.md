# @beesolve/dynamo-helpers

Shared DynamoDB access helpers used across `@beesolve/*` packages — a consistent document client, full query pagination, and single-table batch get.

## Installation

```bash
npm install @beesolve/dynamo-helpers
```

## Utilities

### `toDynamoClient`

Creates a `DynamoDBDocumentClient` with the standard marshall options (`removeUndefinedValues: true`, `convertEmptyValues: false`). When `AWS_PROFILE` is set (local development) it loads credentials from the shared config file; otherwise it falls back to the default AWS credential provider chain (e.g. the Lambda execution role).

```ts
import { toDynamoClient } from "@beesolve/dynamo-helpers";

const dynamo = toDynamoClient();
```

### `queryAll`

Runs a query to completion, following `LastEvaluatedKey` until DynamoDB stops paginating, and returns every matching item. Use this instead of a single `QueryCommand` when a result set may exceed the 1 MB page limit — a raw query silently truncates at that boundary.

```ts
import { queryAll, toDynamoClient } from "@beesolve/dynamo-helpers";

const dynamo = toDynamoClient();

const items = await queryAll({
  dynamo,
  input: {
    TableName: "my-table",
    KeyConditionExpression: "#id = :id",
    ExpressionAttributeNames: { "#id": "id" },
    ExpressionAttributeValues: { ":id": userId },
  },
});
// items: Array<Record<string, unknown>> — validate with your own schema
```

### `batchGet`

Fetches many items from a single table by key. It deduplicates the keys, splits them into batches of 100 (the `BatchGetCommand` limit), and maps the results back to the original key order via a caller-supplied transformer.

```ts
import { batchGet, toDynamoClient } from "@beesolve/dynamo-helpers";

const dynamo = toDynamoClient();

const users = await batchGet<string, User>({
  dynamo,
  tableName: "my-table",
  keys: ["u1", "u2", "u3"],
  toInput: (batch) => ({ Keys: batch.map((id) => ({ pk: `user#${id}`, sk: "user" })) }),
  transform: (raw) => parseUser(raw),
});
```

Throws if a requested key has no corresponding item in the response.

## License

[MIT](../../LICENSE)
