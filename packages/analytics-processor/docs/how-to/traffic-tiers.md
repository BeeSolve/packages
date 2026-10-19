# How to: Filter to real / sitemap traffic with tiers

The site-wide totals and `status`/`country`/`device` breakdowns count **every** logged
request: bots, assets, errors, and (where an origin rewrites unknown paths) redirect noise.
Three parallel tiers let you narrow the same metrics without losing the raw view. See
[ADR-010](../adr-010-real-traffic-breakdowns.md) for the design.

## The three tiers

| Tier    | What it counts             | Athena predicate (added to the time partition)                        |
| ------- | -------------------------- | --------------------------------------------------------------------- |
| `all`   | every request (unchanged)  | none                                                                  |
| `real`  | successful HTML page views | `sc_content_type LIKE 'text/html%' AND sc_status BETWEEN 200 AND 299` |
| `watch` | the active sitemap URL set | `canonical(cs_uri_stem) IN ('/','/blog',…)`                           |

Each tier is stored under its own partition-key namespace and its own applied-marker
namespace, so they are computed, rolled up, and backfilled independently and never collide:

- Totals: `totals#<tier>#<grain>` (the `all` tier keeps the legacy `totals#<grain>`).
- Breakdowns: `breakdown#<tier>#<dimension>#<grain>#<periodKey>`.
- Markers: `applied#<tier>-<grain>#<periodKey>` (`all` keeps `applied#<grain>#…`).

## Enable the `real` tier

The `real` tier needs the `sc_content_type` column in the delivered CloudFront logs. It is
already part of the exported `requiredRecordFields`, so if you configure log delivery from
that constant, redeploying is enough:

```ts
import { requiredRecordFields } from "@beesolve/analytics-processor";

// CloudFrontAccessLoggingSettings
{
  athena: {
    recordFields: requiredRecordFields;
  }
}
```

The `real` tier populates **from the redeploy forward**. There is no historical backfill: the
column does not exist in logs delivered before the change. The predicate is `2xx` only on
purpose — a `3xx` is a redirect, not a page view — so it stays honest even if the origin was
serving redirect noise for unknown paths.

## Enable the `watch` tier

The `watch` tier reuses the sitemap set already maintained for sitemap URL stats (set
`sitemapUrl` on the config; see the sitemap how-to). It no-ops — no query, no write — when no
active sitemap entries exist, so an unconfigured sitemap never triggers a full scan.

The hourly, daily, and monthly handlers compute `all`, `real`, and `watch` automatically once
the above are in place.

## Read a specific tier

The resolvers take a `tier` (default `all`):

```ts
import { resolveBreakdownLive } from "@beesolve/analytics-processor";

const rows = await resolveBreakdownLive({
  models,
  dimension: "status",
  grain: "day",
  periodKey: "2026-02-14",
  tier: "real",
  now: new Date(),
});
```

In the dashboard, the Overview and Breakdowns pages expose a tier selector (All / Real /
Sitemap) wired through the URL.

## Backfill a tier

The `analytics-backfill` command recomputes history per tier:

```bash
# Recompute only the watch tier for a range, with rollups
npx analytics-backfill --stack MyStack --tier watch --rollups \
  --from 2026-02-01T00:00:00Z --to 2026-02-28T23:00:00Z

# Force a recompute even where an applied marker already exists (overwrite)
npx analytics-backfill --stack MyStack --tier real --force --rollups \
  --from 2026-02-01T00:00:00Z --to 2026-02-28T23:00:00Z
```

- `--tier <all|real|watch>` is repeatable; omitting it processes all three.
- `--force` ignores the applied marker and overwrites. It is the lever for a one-off
  recompute after a tier's inputs change. It touches only the stack and tiers you select.
