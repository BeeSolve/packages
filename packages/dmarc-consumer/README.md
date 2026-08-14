# @beesolve/dmarc-consumer

DMARC consumer — persists parsed DMARC reports from EventBridge to DynamoDB and maintains per-domain aggregation counters.

## Architecture

```
┌───────────┐       ┌─────┐       ┌────────┐       ┌──────────┐
│EventBridge│ ────► │ SQS │ ────► │ Lambda │ ────► │ DynamoDB │
└───────────┘       └─────┘       └────────┘       └──────────┘
 DmarcReportParsed    + DLQ        consumer          reports +
                                                     domain aggregates
```

Subscribes to `DmarcReportParsed` events emitted by [`@beesolve/dmarc-reports`](../dmarc-reports), persists them to DynamoDB, and maintains running domain-level counters (total messages, pass, fail).

## Installation

```bash
npm install @beesolve/dmarc-consumer
```

## CDK Usage

```typescript
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";

const consumer = new DmarcConsumer(this, "DmarcConsumer");

// Grant read access to your dashboard Lambda (sets DMARC_TABLE_NAME and DMARC_REVERSE_INDEX env vars)
consumer.grantRead(dashboardLambda);

// Or read/write access
consumer.grantReadWrite(adminLambda);
```

The construct provisions:

- DynamoDB table (on-demand, composite key `pk`/`sk`, reverse GSI, TTL)
- Lambda consumer (Node.js 24, 256 MB, 30s timeout)
- SQS queue with dead-letter queue
- EventBridge rule matching `source: "dmarc-reports"` + `detail-type: "DmarcReportParsed"`

## Querying Data

### List all monitored domains

```typescript
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Domains } from "@beesolve/dmarc-consumer/domain";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

const domains = new Domains({
  dynamo,
  tableName: process.env.DMARC_TABLE_NAME!,
  reverseIndexName: process.env.DMARC_REVERSE_INDEX!,
});

const allDomains = await domains.list();
// [{ domain: "example.com", totalMessages: 15420, totalPass: 15100, totalFail: 320 }, ...]
```

### Query reports by domain

```typescript
import { Reports } from "@beesolve/dmarc-consumer/report";

const reports = new Reports({
  dynamo,
  tableName: process.env.DMARC_TABLE_NAME!,
});

// Paginated, newest first
const { reports: domainReports, cursor } = await reports.queryByDomain({
  domain: "example.com",
  startTime: 1704067200, // optional: Unix timestamp
  endTime: 1706745600, // optional: Unix timestamp
  limit: 20, // default: 50
});

// Fetch next page
const nextPage = await reports.queryByDomain({
  domain: "example.com",
  cursor,
});
```

## DynamoDB Schema

| pk                   | sk                                        | Description                                            |
| -------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `domain#example.com` | `domain`                                  | Domain aggregate (totalMessages, totalPass, totalFail) |
| `domain#example.com` | `report#{timestamp}#{orgName}#{reportId}` | Individual report                                      |

The reverse GSI (`sk` as partition key) enables listing all domains by querying `sk = "domain"`.

## Consumer Behavior

1. Parses each SQS record against the `DmarcReportParsedEvent` schema
2. Batch-persists valid reports (chunks of 25 for DynamoDB limits)
3. Atomically increments domain aggregate counters via `ADD` expressions
4. Returns failed message IDs for SQS partial batch failure (retry via DLQ)
5. Domain upsert failures are logged but do not block report persistence

## License

[MIT](../../LICENSE)
