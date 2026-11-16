# ADR-002: Why This Package Exists

## Status

Accepted

## Context

Lambda-based services in this repository repeat the same CDK building blocks: a
Node.js Lambda with consistent defaults, a queue with a dead-letter queue, a
CloudFront and S3 static website with security headers, and CloudFront access
logging. Each requires many CDK resources and settings, and getting them
consistent across stacks is easy to miss.

Many workspace packages (`@beesolve/sqs-handler`, `@beesolve/auth-service`,
`@beesolve/email-service`, `@beesolve/dmarc-reports`, `@beesolve/analytics-processor`,
`@beesolve/lambda-keep-active`, and the samples) declare `@beesolve/cdk-constructs`
as a dependency.

## Decision

Maintain `@beesolve/cdk-constructs` as a standalone CDK library of opinionated
constructs:

- `Nodejs24Function`: ARM64, esbuild ESM bundling, JSON logging, managed log group
  with 2-week retention, and `tagFunctionsWithRevision`
- `SqsWithDlq`: queue plus DLQ with SQS-managed encryption, SSL enforced, and
  `asLambdaInput` for event source wiring
- `StaticWebsite`: CloudFront and S3 with security headers, optional custom domain,
  basic auth, and SPA/MPA modes
- `CloudFrontAccessLoggingSettings`: log bucket with optional Glue and Athena
  querying (see ADR-001)
- `esmBuild` / `esmBuildSync`: the esbuild wrapper used by the function construct

## Rationale

### 1. Defaults defined once

Runtime, architecture, logging, encryption and security-header choices are made in
the construct. Stacks state only what differs.

### 2. Shared by packages with their own CDK entry points

Packages such as `@beesolve/dmarc-reports` ship their own construct and build on
`Nodejs24Function`, instead of each configuring bundling and logging itself.

### 3. Peer-dependency CDK

`aws-cdk-lib` and `constructs` are peer dependencies, so the consuming app controls
the CDK version. The only runtime dependencies are `@beesolve/helpers` and `esbuild`.

## Consequences

- Stacks get consistent, secure-by-default infrastructure with little code.
- The constructs are opinionated: Node.js 24, ARM64, ESM output. Needs outside
  those defaults are not served.
- A change to a default affects every stack that uses the construct, so changes
  to the constructs need versioning care.
- Domain-specific infrastructure (DMARC ingestion, auth, email) stays in the
  packages that own that domain. This package holds only generic building blocks.

## Alternatives Considered

### Configure each resource inline per stack

Rejected. The same settings would be repeated and could differ between stacks.

### Use `NodejsFunction` from `aws-cdk-lib`

Rejected. It does not provide the repository's ARM64, ESM, JSON-logging and log
retention defaults, and bundling is delegated to a build step that the construct
here wraps with `esmBuild`.

### Split into one package per construct

Rejected. The constructs share defaults and the esbuild wrapper, and one package is
simpler to version and install.
