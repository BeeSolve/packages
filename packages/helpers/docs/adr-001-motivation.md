# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Backends and libraries in this repository repeat a small set of generic TypeScript
needs that have nothing to do with any one domain:

- Exhaustive-check helper (`assertUnreachable`) and null-filtering type guard (`isNotNil`)
- Array and record utilities (`toRecordByProperty`, `splitArrayToChunks` for batch
  limits such as DynamoDB, `toggleInArray`)
- Sortable, case-insensitive-safe identifiers (`uuid7`, `uuid7ToDate`) built on base36
  encoding (`base36Encode`, `base36Decode`)
- Round-tripping rich values (Date, BigInt, Buffer, Infinity, NaN, FormData) through
  JSON (`encodeToStringifiable`, `decodeFromStringifiable`)
- Deterministic JSON output (`stableJsonStringify`, `sortObjectKeysRecursively`)
- A Bun-only CLI argument parser validated by a Valibot schema (`parseArgs`)

Many workspace packages declare `@beesolve/helpers` as a dependency, including
`@beesolve/cdk-constructs`, `@beesolve/sqs-handler`, `@beesolve/lambda-fetch-api`,
`@beesolve/ip-info`, and the email and analytics packages.

## Decision

Keep these utilities in one standalone leaf package, `@beesolve/helpers`. The root
entry point exports the runtime-neutral utilities. The Bun-specific `parseArgs` is
exposed on a separate `@beesolve/helpers/bun` subpath so that Node.js consumers never
load Bun APIs.

## Rationale

### 1. One implementation instead of per-package copies

Utilities such as `assertUnreachable` and `splitArrayToChunks` are needed by many
packages. A shared package gives one implementation and one test suite instead of
copies that drift.

### 2. A leaf with minimal dependencies

The only runtime dependency is `valibot`. Because the package depends on no other
workspace package, any package can depend on it without creating a cycle.

### 3. Runtime split by subpath

Packages target both Bun and Node.js. Isolating the Bun-only code behind
`./bun` keeps the root entry point safe to import in a Lambda or any Node.js process.

## Consequences

- Any change to a helper can affect many packages, so the public surface needs
  careful versioning once it is stable.
- The package has no domain scope. It is a collection of unrelated small utilities,
  so it must stay small and must not take on AWS, CDK, or DMARC logic.

## Alternatives Considered

### Inline the helpers in each package

Rejected. The same small functions would be duplicated across many packages and
diverge over time.

### Use a third-party utility library

Rejected. A general-purpose library brings a much larger surface than the few
functions needed. The helpers here (base36 UUIDv7, the stringifiable encoding, the
Valibot-based `parseArgs`) are specific to this repository's conventions.
