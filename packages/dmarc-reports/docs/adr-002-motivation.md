# ADR-002: Why This Package Exists

## Status

Accepted

## Context

DMARC aggregate reports are sent by mailbox providers to the address in a domain's
`rua` DMARC tag. Collecting them on AWS requires SES to receive mail on a dedicated
subdomain, an S3 bucket for the raw messages, a Lambda function to process them,
and a way for downstream systems to learn about each parsed report.

The pieces need to fit together: an SES receipt rule set that is active, a bucket
policy that lets SES write and sends Object Created events to EventBridge, a
lifecycle rule for old messages, and a handler that checks SES verdicts before
parsing (see ADR-001).

## Decision

Provide `@beesolve/dmarc-reports` as a standalone ingestion package with two entry
points:

- `@beesolve/dmarc-reports/cdk`: the `DmarcReports` construct (SES receipt rule,
  S3 bucket with 90-day expiration, handler Lambda, EventBridge rule)
- `@beesolve/dmarc-reports`: the runtime contract, with the event source and
  detail types (`DmarcReportParsed`, `DmarcProcessingStats`), their Valibot
  schemas and the `isDmarcReportParsedEvent` guard

The handler emits parsed reports as EventBridge events and does not store or
present them.

## Rationale

### 1. Infrastructure and handler ship together

The receipt rule, bucket and Lambda depend on each other's names, permissions and
event shape. One package deploys them as one construct.

### 2. Events decouple ingestion from consumers

The package publishes validated `DmarcReportParsed` events on an EventBridge bus
(the account default bus unless `eventBusArn` is given). Consumers such as
`@beesolve/dmarc-consumer` subscribe and decide what to do with the data. The
ingestion package does not know about storage or UI.

### 3. Parsing stays in `@beesolve/dmarc-parser`

MIME extraction, decompression and XML validation are delegated to the parser
package. This package adds the AWS layer: reading from S3, checking SES verdicts,
and emitting events.

## Consequences

- Deploying the construct and pointing the `rua` tag at its recipient address is
  enough to start ingesting reports.
- The package targets SES inbound mail. It requires an SES-verified receiving
  subdomain and region support for SES receiving, and does not read reports from
  other sources.
- Event consumers depend on the `DmarcReportParsed` event shape, so changes to it
  are breaking for them.
- Storing, aggregating and displaying reports are out of scope. They belong to
  `@beesolve/dmarc-consumer` and `@beesolve/dmarc-dashboard`.

## Alternatives Considered

### Process reports in the consuming application

Rejected. Each consumer would need its own SES, S3 and Lambda setup and its own
verdict checks.

### Write parsed reports directly to a database

Rejected. It would tie ingestion to one storage model. Events allow several
consumers and keep the package free of a data store.
