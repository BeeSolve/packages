# How to: Get started with the DMARC consumer

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports

## Prerequisites

- A deployed `@beesolve/dmarc-reports` pipeline emitting `DmarcReportParsed` events
- A CDK app (`aws-cdk-lib` + `constructs`)

## Steps

### 1. Install

```sh
bun add @beesolve/dmarc-consumer
```

```sh
npm install @beesolve/dmarc-consumer
```

### 2. Deploy the consumer

`DmarcConsumer` provisions a DynamoDB table, an SQS-buffered Lambda, and an
EventBridge rule matching `DmarcReportParsed`. Grant your query Lambda read access
— it sets `DMARC_TABLE_NAME` and `DMARC_REVERSE_INDEX`.

```ts
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";

const consumer = new DmarcConsumer(this, "DmarcConsumer");

consumer.grantRead(dashboardLambda);
```

### 3. Query persisted data

Create a document client, then use the `Domains` and `Reports` models.

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Domains } from "@beesolve/dmarc-consumer/domain";
import { Reports } from "@beesolve/dmarc-consumer/report";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

const domains = new Domains({
  dynamo,
  tableName: process.env.DMARC_TABLE_NAME!,
  reverseIndexName: process.env.DMARC_REVERSE_INDEX!,
});

const allDomains = await domains.list();

const reports = new Reports({ dynamo, tableName: process.env.DMARC_TABLE_NAME! });
const { reports: page, cursor } = await reports.queryByDomain({
  domain: "example.com",
  limit: 20,
});
```

## Common Pitfalls

- The consumer only runs once `@beesolve/dmarc-reports` is emitting events — deploy it first.
- Pass the `marshallOptions` shown above or writes with undefined fields can fail.
- `queryByDomain` is paginated: pass the returned `cursor` back to fetch the next page.

## See Also

- [README](../../README.md) — DynamoDB schema, consumer behavior, query options
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports)
