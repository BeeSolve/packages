# @beesolve/dmarc-reports - Documentation

**Keywords:** DMARC, aggregate report, ingestion, SES receiving, DmarcReports construct, EventBridge, DmarcReportParsed, isDmarcReportParsedEvent, rua, report parsing

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/dmarc-reports

## How-To Guides

| Guide                                               | Description                                                   |
| --------------------------------------------------- | ------------------------------------------------------------- |
| [Getting Started](./docs/how-to/getting-started.md) | Install, deploy ingestion, consume `DmarcReportParsed` events |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                       | What it shows                                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [dmarcReports](https://github.com/BeeSolve/packages/tree/main/packages/samples/dmarcReports) | End-to-end DMARC pipeline: ingestion, persistence, and dashboard |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/dmarc-reports/docs) (GitHub only)
