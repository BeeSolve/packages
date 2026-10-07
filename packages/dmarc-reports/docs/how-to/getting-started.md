# How to: Get started with DMARC report ingestion

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports

## Prerequisites

- An AWS account with SES receiving available in your region
- A subdomain for receiving reports (e.g. `dmarc.example.com`) with an MX record pointing to SES inbound
- A CDK app (`aws-cdk-lib` + `constructs`)

## Steps

### 1. Install

```sh
bun add @beesolve/dmarc-reports
```

```sh
npm install @beesolve/dmarc-reports
```

### 2. Deploy the ingestion construct

`DmarcReports` wires SES receiving to S3, then runs a Lambda that extracts and
parses the XML and emits a `DmarcReportParsed` event to EventBridge.

```ts
import { DmarcReports } from "@beesolve/dmarc-reports/cdk";

new DmarcReports(this, "DmarcReports", {
  recipient: "rua@dmarc.example.com",
});
```

### 3. Point your DMARC record at the recipient

Add the `rua` tag to the DMARC TXT record of each domain you monitor:

```
_dmarc.example.com  TXT  "v=DMARC1; p=reject; rua=mailto:rua@dmarc.example.com; pct=100"
```

### 4. Consume parsed events

Subscribe a Lambda to the `DmarcReportParsed` event and narrow it with the
type guard — `event.detail` is then typed as `DmarcReport`.

```ts
import { isDmarcReportParsedEvent } from "@beesolve/dmarc-reports";

export async function handler(event: unknown): Promise<void> {
  if (!isDmarcReportParsedEvent(event)) return;

  const report = event.detail;
  console.log(report.reportMetadata.orgName, report.policyPublished.domain);
}
```

For durable storage and per-domain aggregates, deploy
`@beesolve/dmarc-consumer`, which subscribes to these events automatically.

## Common Pitfalls

- SES receiving works in the sandbox only for verified addresses; request production access to accept reports from external senders.
- Use a dedicated subdomain to avoid clashing with existing mail routing.
- Reports typically start arriving 24–48 hours after you update the `rua` tag.

## See Also

- [README](../../README.md) — SES setup guide, construct props, cost estimate
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports)
