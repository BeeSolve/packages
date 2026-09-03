# Setting up ipinfo.io source IP enrichment

DMARC aggregate reports identify senders only by raw source IP. Enrichment turns
those IPs into a readable ASN / organization name and country (e.g. `112.201.67.110`
→ "Philippine Long Distance Telephone · Philippines") so the Source IP Analysis and
report tables are meaningful.

Enrichment is **optional**. Without an API key it is skipped entirely and the ASN /
country columns render as `—`; everything else works unchanged.

The design rationale (why ipinfo Lite, why a per-IP cache, why presence-only) lives
in [`dmarc-consumer` ADR-002](../../dmarc-consumer/docs/adr-002-ip-enrichment-cache.md).
This doc is the practical setup.

## How it works

- Provider: the **ipinfo.io Lite API** — `GET https://api.ipinfo.io/lite/<ip>` with an
  `Authorization: Bearer <key>` header. The Lite tier is free and returns ASN,
  organization name/domain, and country.
- Results are cached per IP as `pk: ipinfo#<ip>`, `sk: ipinfo` items in the existing
  DMARC table, looked up once and reused thereafter (presence-only, no TTL).
- **Where the key is needed:**
  - **`dmarc-consumer`** — enriches new source IPs at ingestion time, and runs the
    per-domain backfill triggered by the dashboard's "Refresh IP details" button.
    This is the component that actually calls ipinfo, so the key matters most here.
  - **`dmarc-dashboard`** — reads the cache at render time (`getMany`) and never calls
    the API itself. The key is accepted (`IPINFO_API_KEY`, optional) but the dashboard
    does not perform lookups directly; enrichment writes go through the consumer.

## Get an API key

1. Create a free account at <https://ipinfo.io/signup>.
2. From the dashboard, copy your access **token** (this is the `IPINFO_API_KEY`).
3. The free **Lite** tier is sufficient — see <https://ipinfo.io/developers/lite-api>.

Treat the token as a secret: do not commit it. Locally it lives in the gitignored
`.env.local`; in AWS it should come from Secrets Manager / SSM, not a hardcoded string.

## Local development

Add the key to `.env.local` (see [`.env.local.example`](../.env.local.example)):

```dotenv
IPINFO_API_KEY=your-ipinfo-token
```

`bun run dev` loads it into `process.env`. Note that the dashboard only **reads**
cached enrichment locally — new lookups happen in the consumer. To see enriched data
locally, point `.env.local` at a table whose IPs were already enriched by a deployed
consumer, or run the consumer/backfill against the same table with the key set.

## Deployed setup (CDK)

The key is wired through the **consumer** construct via the optional `ipInfoApiKey`
prop, which sets `IPINFO_API_KEY` on both the consumer and the backfill/tasks Lambda:

```ts
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";

const consumer = new DmarcConsumer(stack, "DmarcConsumer", {
  // Prefer resolving from Secrets Manager / SSM rather than a literal string.
  ipInfoApiKey: process.env.IPINFO_API_KEY,
});
```

When `ipInfoApiKey` is omitted, enrichment is skipped everywhere and the dashboard
renders without ASN / country data.

## Backfilling historical data

Reports ingested before a key was configured are not enriched automatically. Use the
per-domain **"Refresh IP details"** button on the Domain Overview page — it triggers
the consumer's backfill job, which enriches every source IP for that domain. Because
caching is presence-only, re-running a backfill only looks up IPs that are not already
cached, so it is cheap to repeat.
