# ADR-001: Why This Package Exists

## Status

Accepted

## Context

DMARC aggregate reports arrive as email. The report is an XML attachment, usually
gzip- or zip-compressed, and the XML uses snake_case names and collapses a single
child element into an object instead of an array. Turning a received email into
typed data takes three steps:

1. Extract the report attachments from a raw MIME message
2. Decompress `.gz` or `.zip` attachments
3. Parse and validate the XML into a typed structure

The ingestion pipeline (`@beesolve/dmarc-reports`) needs all three steps, and
`@beesolve/dmarc-consumer` and `@beesolve/dmarc-dashboard` also depend on the
parser and its types.

## Decision

Provide `@beesolve/dmarc-parser` as a standalone package with pure functions and no
AWS dependency: `parseXml`, `decompress` (with `decompressGzip` and
`decompressZip`), `extractFromEmail`, plus the `dmarcReportSchema` and
`dmarcRecordSchema` Valibot schemas and the types inferred from them.

## Rationale

### 1. Shared types and schema

The report shape is defined once as a Valibot schema. The ingestion Lambda uses it
to validate parsed reports, and the other DMARC packages use the same type. They do
not need to depend on the AWS-specific ingestion package for it.

### 2. No AWS coupling

The functions take a string or a `Buffer` and return data. They run in a Lambda, a
script, or a test with a fixture, and do not need an S3 client or an event.

### 3. Bounded dependencies

The package depends on `fast-xml-parser`, `mailparser` and `valibot`. Zip
extraction uses `node:zlib` directly, so no zip library is needed. Keeping them in
one package keeps those dependencies out of packages that only consume the types.

## Consequences

- The ingestion, consumer and dashboard packages agree on one report type.
- Zip support covers extracting the first `.xml` entry, which is what DMARC reports
  need. It is not a general zip reader.
- The parser does not fetch emails, check SES verdicts, or emit events. Those
  belong to `@beesolve/dmarc-reports`.
- Malformed reports fail schema validation with an error. The package does not
  repair them.

## Alternatives Considered

### Keep the parsing code inside `@beesolve/dmarc-reports`

Rejected. Other DMARC packages need the report type and schema, and would have to
depend on the CDK and Lambda package to get them.

### Use a third-party DMARC parsing library

Rejected. The report XML still has to be normalized (snake_case to camelCase,
single element versus array) and validated against the schema used across the
workspace.
