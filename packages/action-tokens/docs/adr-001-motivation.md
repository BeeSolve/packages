# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Many authentication and verification flows require short-lived, single-use credentials: email verification codes, magic link tokens, OTP codes, password reset tokens, invite links. These tokens share common requirements:

- Create with a defined TTL and maximum use count
- Verify atomically (prevent double-use under concurrent requests)
- Protect against brute-force enumeration
- Clean up automatically after expiry
- Optionally throttle creation per identity (prevent spamming)

This logic is non-trivial to implement correctly — especially the atomic conditional writes that prevent a token from being used twice when two requests arrive simultaneously. Every project that needs "send a code, verify the code" ends up building this from scratch.

## Decision

Extract the one-time token store into a standalone package providing:

- **DynamoDB-backed model** with atomic conditional updates for use-counting
- **Brute-force protection** — remaining uses are decremented even on incorrect attempts, preventing enumeration
- **TTL-based cleanup** — expired tokens are automatically removed by DynamoDB
- **Per-identity throttling** — optional rate limiting on token creation using DynamoDB transactions
- **CDK construct** — provisions the table, GSI, and TTL configuration
- **SDK client** — for cross-service communication (e.g. auth service calling token service)

## Rationale

### 1. Generic primitive, not auth-specific

The token store is useful for any "create credential → use credential" flow. Separating it from `@beesolve/auth-service` means it can be used independently for email change confirmation, invite acceptance, file download links, or any other single-use token pattern.

### 2. Correctness is hard

Atomic use-counting under concurrency (DynamoDB conditional expressions), brute-force protection (decrement on wrong value), and throttling (transactions across multiple items) are all subtle to implement. Centralizing this in a tested package avoids each consumer getting it subtly wrong.

### 3. CDK construct + SDK client pattern

The same pattern used across other `@beesolve` packages: one construct deploys the infrastructure, one SDK client provides remote access. Consumers can deploy their own table or call an existing one via the SDK.

## Consequences

- Any project needing one-time tokens gets a tested, correct implementation with a single dependency.
- The package is DynamoDB-only — not portable to other databases. Acceptable given the AWS-focused target audience.
- Single-region deployment (see ADR: Single-Region DynamoDB Table) means consumers in multi-region setups must route to the token table's region.

## Alternatives Considered

### Bundle token logic inside auth-service

Rejected. The token store is a general-purpose primitive. Coupling it to auth would prevent reuse in non-auth contexts (invite links, file access tokens, etc.).

### Use Redis/ElastiCache for token storage

Rejected. Adds a non-serverless resource (ongoing cost regardless of usage), requires VPC configuration, and DynamoDB conditional writes provide the same atomic guarantees with serverless scaling.
