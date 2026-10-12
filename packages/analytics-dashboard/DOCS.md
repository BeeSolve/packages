# @beesolve/analytics-dashboard - Documentation

**Keywords:** CloudFront analytics dashboard, traffic analytics, AnalyticsDashboard construct, CDK, SvelteKit, CloudFront, DynamoDB, email-code auth, hits/errors/bytes, status/country/device/path breakdowns

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/analytics-dashboard

## How-To Guides

| Guide                                               | Description                                          |
| --------------------------------------------------- | ---------------------------------------------------- |
| [Getting Started](./docs/how-to/getting-started.md) | Install, wire the pipeline, backfill history, deploy |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                 | What it shows                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [analytics](https://github.com/BeeSolve/packages/tree/main/packages/samples/analytics) | End-to-end analytics pipeline: v2 logging, processor, and the dashboard |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/analytics-dashboard/docs) (GitHub only)
