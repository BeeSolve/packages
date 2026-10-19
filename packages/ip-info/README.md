# @beesolve/ip-info

IP enrichment (country/ASN) backed by a DynamoDB presence cache. Looks up IP
metadata via [ipinfo.io](https://ipinfo.io) and caches results so each IP is
fetched at most once.

> [!WARNING]
> **Pre-1.0 — unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

## Installation

```bash
npm install @beesolve/ip-info
```

## Usage

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { IpInfoCache } from "@beesolve/ip-info";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

const cache = new IpInfoCache({
  dynamo,
  tableName: "my-table",
  apiKey: process.env.IPINFO_API_KEY,
});

// Enrich on demand (fetches + stores on cache miss, no-op without an apiKey).
await cache.enrich({ ip: "8.8.8.8" });
await cache.enrichMany({ ips: ["8.8.8.8", "1.1.1.1"] });

// Read-only lookups (no API key required).
const one = await cache.get({ ip: "8.8.8.8" });
const many = await cache.getMany({ ips: ["8.8.8.8", "1.1.1.1"] });
```

The cache stores one item per IP under `pk = ipinfo#<sha256(ip)>`, `sk = ipinfo`.
The raw IP address is never persisted - the item is keyed by a SHA-256 hash of
the IP and carries only the derived enrichment (country/ASN), so an IP cannot be
read back out of the table. `get`/`getMany`/`enrich`/`enrichMany` take the IP as
input and return results keyed by that input IP.
`enrich`/`enrichMany` only call the API for IPs not already cached, and return
`null`/`{}` respectively when no `apiKey` is configured.

## API

| Export              | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `IpInfoCache`       | DynamoDB-backed cache with `get`/`getMany`/`put`/`enrich`/`enrichMany` |
| `lookupIpInfo`      | Direct, uncached ipinfo.io lite lookup for a single IP                 |
| `IpInfo`            | Normalized lookup result shape                                         |
| `IpInfoCacheItem`   | Stored cache record shape                                              |
| `ipInfoCacheSchema` | Valibot schema for a stored cache record                               |

## License

[MIT](../../LICENSE)
