# How to: Track per-article hits with sitemap URL stats

The hourly pipeline keeps only a top-100-by-hits `path` breakdown per hour; every other
path collapses into a single `__other__` bucket and loses its identity. Because bots hammer
junk URLs, genuine articles routinely fall into `__other__`. Sitemap URL stats are a
**separate, parallel model** that sidesteps this: a known set of URLs (the site's sitemap) is
counted per day directly from Athena and stored one item per `(path, year-month)`. The live
hourly processor accumulates incrementally (`ADD` + a per-hour marker); the backfill command
recomputes a whole month in one scan and overwrites (`SET`). See
[ADR-007](../adr-007-sitemap-url-stats.md) for the full rationale.

## Configure the sitemap URL

The processor reads a `sitemapUrl` from the shared config item. Set it from the dashboard
Settings page, or directly through `Config`:

```ts
import { Config } from "@beesolve/analytics-processor";

const config = new Config({ dynamo, tableName });
await config.setSitemapUrl({ sitemapUrl: "https://example.com/sitemap.xml" });
```

The hourly sitemap processor fetches that URL and parses the `<loc>` entries, canonicalizing
each to a path. The path set is held in memory for the run only - it is not persisted; only
`sitemapUrl` lives on the config item. If `sitemapUrl` is unset, the processor logs and
returns without touching Athena.

## What the processor does each hour

1. Fetches and parses the sitemap path set from `sitemapUrl` (held in memory for the run). The
   request is sent with a `User-Agent` of `@beesolve/analytics-processor sitemap fetcher`
   (exported as `sitemapUserAgent`) so site operators can identify it in their access logs.
2. Runs one Athena query for a single lagged UTC hour grouped by `path`, restricted to the
   sitemap paths (the same hour-at-a-time slice the main hourly pipeline uses).
3. In one `TransactWrite`, writes an applied-marker for that hour and `ADD`s each path's hits
   into the matching day's `dNN` attribute and the `hits` month rollup.

The applied-marker (`applied#sitemap#<hourKey>`, conditional and sharing the transaction) makes
each hour count exactly once, so a retried or overlapping run is a safe no-op. This hour-at-a-
time `ADD` is far cheaper on Athena than re-scanning the whole month every run. Paths are
canonicalized identically on both sides (the stored sitemap path and the logged `cs-uri-stem`):
a single trailing slash is collapsed (`/blog/` -> `/blog`) while root `/` is preserved, so a
page and its 301-redirect hit both count against the same path. All hits are counted; there is
no bot filtering.

## Read the stats

Use the `SitemapUrlStats` model. It reshapes the flat `dNN` attributes back into a per-day
record on read.

```ts
import { SitemapUrlStats } from "@beesolve/analytics-processor";

const stats = new SitemapUrlStats({ dynamo, tableName, reverseIndexName });

// One URL across a month range (main table).
const series = await stats.getForUrl({
  path: "/blog/getting-started",
  startMonth: "2025-06",
  endMonth: "2026-05",
});

// All URLs for one month (reverse index) - e.g. to compare months by article.
const may = await stats.getForMonth({ month: "2026-05" });
```

`getForUrl` answers "how did this article trend over time"; `getForMonth` answers "which
articles were read most this month", and joining two `getForMonth` results by `path` yields a
month-over-month comparison. These items carry no TTL, so historical months persist for
year-over-year comparison.
