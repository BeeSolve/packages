# @beesolve/analytics-processor - Documentation

**Keywords:** CloudFront analytics, Athena, DynamoDB totals, breakdowns, rollups, AnalyticsProcessor construct, grantRead, processHour, hourKey, windowKeys, Grain, Dimension, backfill

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/analytics-processor

This package does not ship how-to guides. See the [README](./README.md) for the API
reference and usage, and the GitHub repository for source and examples.

## How-To Guides

- [Reduce Athena cost](./docs/how-to/reduce-athena-cost.md) - deliver only the 10 fields
  the processor needs via the exported `requiredRecordFields`

## Further Reading

- [README](./README.md) - API reference and usage
- [CHANGELOG](./CHANGELOG.md) - Version history
