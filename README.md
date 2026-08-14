# BeeSolve packages

Open-source TypeScript packages for building serverless applications on AWS. Built with CDK, Lambda, DynamoDB, SES, and SQS.

All packages target Node.js 24+ and are published as ESM.

## Packages

| Package                                                       | Description                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@beesolve/auth-service`](packages/service-auth)             | Email code authentication with session management, Lambda authorizer, and SvelteKit integration |
| [`@beesolve/email-service`](packages/service-email)           | Transactional email service with React Email templates and SES                                  |
| [`@beesolve/action-tokens`](packages/action-tokens)           | DynamoDB-backed one-time action tokens (OTP codes, magic links, email verification)             |
| [`@beesolve/lambda-fetch-api`](packages/lambda-fetch-api)     | Fetch API adapter for AWS Lambda — write handlers as `(request: Request) => Response`           |
| [`@beesolve/sqs-handler`](packages/sqs-handler)               | Type-safe SQS consumer with CDK construct and dead-letter queue                                 |
| [`@beesolve/cdk-constructs`](packages/cdk-constructs)         | Opinionated CDK constructs: Nodejs24Function, SqsWithDlq, StaticWebsite                         |
| [`@beesolve/cdk-email-alarms`](packages/cdk-email-alarms)     | CDK construct for email-based CloudWatch alarms                                                 |
| [`@beesolve/lambda-keep-active`](packages/lambda-keep-active) | Lambda warmer — periodic invocations to prevent cold starts                                     |
| [`@beesolve/dmarc-parser`](packages/dmarc-parser)             | DMARC aggregate report parser — XML parsing, decompression, and MIME extraction                 |
| [`@beesolve/dmarc-reports`](packages/dmarc-reports)           | DMARC report ingestion pipeline — SES to S3 to EventBridge via Lambda                           |
| [`@beesolve/dmarc-consumer`](packages/dmarc-consumer)         | DMARC consumer — persists parsed DMARC reports from EventBridge to DynamoDB                     |
| [`@beesolve/helpers`](packages/helpers)                       | Shared TypeScript utilities (serialization, retry, type guards)                                 |
| [`@beesolve/lint-config`](packages/lint-config)               | Shared Oxlint + Oxfmt linting and formatting configuration                                      |
| [`@beesolve/samples`](packages/samples)                       | Deployable reference implementations showcasing the packages above (not published to npm)       |

## Installation

```bash
npm install @beesolve/<package-name>
```

Each package's README contains detailed usage instructions and API documentation.

## Prerequisites

- [Bun](https://bun.sh) — package manager and script runner
- [Node.js 24+](https://nodejs.org) — application runtime
- [mise](https://mise.jdx.dev) — version manager (for environment variables in samples)

## Development

```bash
bun install             # install dependencies
bun run build           # build all packages
bun run type-check      # type-check all packages
bun run test            # run all tests
bun run lint            # lint with oxlint
bun run fmt:check       # check formatting with oxfmt
```

### Adding a new package

```bash
bun run add-package <name>
```

See [docs/adding-a-package.md](docs/adding-a-package.md) for the full guide.

### Making changes

Create a changeset describing the version bump before opening a PR:

```bash
bunx changeset
```

After the PR merges to `main`, the Changesets bot opens a "Version Packages" PR that bumps versions and writes CHANGELOG entries. Merging that PR publishes all changed packages automatically.

### Dependency order

`dependencies.json` records the topological publish order. Regenerate after adding or removing intra-monorepo dependencies:

```bash
bun run recalculate-dependencies
```

## License

[MIT](LICENSE) — BeeSolve s.r.o.
