# @beesolve/dmarc-reports

DMARC report ingestion pipeline — receives aggregate reports via SES, parses them, and emits structured events to EventBridge.

## Architecture

```
                    ┌─────────┐
DMARC reports ──►  │   SES   │
(email)            └────┬────┘
                        │
                        ▼
                   ┌─────────┐
                   │   S3    │  (inbox/, 90-day lifecycle)
                   └────┬────┘
                        │ EventBridge (Object Created)
                        ▼
                   ┌─────────┐
                   │ Lambda  │  Parse MIME → extract XML → validate
                   └────┬────┘
                        │
                        ▼
                  ┌───────────┐
                  │EventBridge│  DmarcReportParsed events
                  └───────────┘
```

## Installation

```bash
npm install @beesolve/dmarc-reports
```

## SES Setup Guide

Use a dedicated subdomain for receiving DMARC reports (e.g. `dmarc.example.com`). This keeps it separate from your main email routing.

### 1. Verify the subdomain in SES

Add `dmarc.example.com` as a verified identity in SES. This tells SES to accept inbound email for this domain. You do **not** need Custom MAIL FROM, SPF, or DKIM for this identity — it is receive-only.

### 2. Set up MX record

Point the subdomain to SES inbound in Route 53 (or your DNS provider):

```
dmarc.example.com  MX  10 inbound-smtp.<region>.amazonaws.com
```

Replace `<region>` with your SES region (e.g. `eu-central-1`).

### 3. Update your DMARC DNS record

On each domain you want to collect reports for, update (or add) the DMARC TXT record to include the `rua` tag pointing to your new address:

```
_dmarc.example.com  TXT  "v=DMARC1; p=reject; rua=mailto:rua@dmarc.example.com; pct=100"
```

### 4. SES sandbox vs production

By default, SES accounts are in sandbox mode. Inbound receiving works in sandbox **only** for verified email addresses. To receive DMARC reports from external senders (Google, Microsoft, Yahoo, etc.), you must request production access via the AWS Console.

### Notes

- No SPF/DKIM/Custom MAIL FROM is needed on the receiving subdomain — those are only required for _sending_ emails
- The CDK construct automatically activates the SES receipt rule set
- Reports typically start arriving within 24–48 hours after updating the DMARC `rua` tag
- Use a subdomain (not your main domain) to avoid conflicts with existing email routing (e.g. Google Workspace catch-all rules)

## CDK Usage

```typescript
import { DmarcReports } from "@beesolve/dmarc-reports/cdk";

const dmarcReports = new DmarcReports(this, "DmarcReports", {
  recipient: "dmarc@dmarc.example.com",
  // Optional: custom event bus
  eventBusArn: "arn:aws:events:us-east-1:123456789012:event-bus/custom",
  // Optional: override Lambda props
  handlerProps: {
    memorySize: 512,
    timeout: Duration.seconds(60),
  },
});
```

## Event Consumer Example

```typescript
import { isDmarcReportParsedEvent, eventSource, detailType } from "@beesolve/dmarc-reports";

// In an EventBridge rule target (Lambda handler):
export async function handler(event: unknown): Promise<void> {
  if (!isDmarcReportParsedEvent(event)) {
    console.error("Invalid event received");
    return;
  }

  // event.detail is fully typed as DmarcReport
  const report = event.detail;
  console.log(`Report from ${report.reportMetadata.orgName} for ${report.policyPublished.domain}`);

  for (const record of report.records) {
    if (record.policyEvaluated.dkim === "fail" || record.policyEvaluated.spf === "fail") {
      console.warn(`Auth failure from ${record.sourceIp} (${record.count} messages)`);
    }
  }
}
```

## Cost Estimate

At expected volume (~5–10 reports/day per domain):

| Service     | Calculation                                            | Cost/month |
| ----------- | ------------------------------------------------------ | ---------- |
| SES         | $0.10/1000 emails → ~150–300 emails/month              | ~$0.01     |
| S3          | Reports are <10KB each, 90-day lifecycle               | minimal    |
| Lambda      | ~300 invocations × 256MB × <1s = well within free tier | $0.00      |
| EventBridge | $1/million events → ~300 events/month                  | ~$0.00     |
| **Total**   |                                                        | **<$0.10** |

## Useful Links

- [EasyDMARC DMARC Lookup](https://easydmarc.com/tools/dmarc-lookup)
- [Mail Tester](https://www.mail-tester.com)
- [MxToolbox DMARC](https://mxtoolbox.com/dmarc.aspx)
