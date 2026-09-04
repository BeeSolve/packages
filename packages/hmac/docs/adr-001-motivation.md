# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Several `@beesolve` services need to sign and verify opaque string payloads with a
shared secret: webhook payloads, callback URLs, tamper-evident tokens passed between
services, and similar integrity checks. The requirement is always the same — produce a
deterministic HMAC signature for a string and later confirm a given signature matches.

Node's `crypto.createHmac` provides the primitive, but every consumer ends up
re-writing the same small wrapper: choosing an algorithm, deciding how the pre-shared
key is encoded, computing the digest, and comparing signatures. These details are easy
to get subtly inconsistent across services (e.g. key encoding, digest encoding), which
breaks interoperability when one service signs and another verifies.

## Decision

Extract the HMAC sign/verify wrapper into a standalone package providing a single
`HmacSigner` class:

- `sign(value)` — produces a hex HMAC digest of a string using a hex-encoded
  pre-shared key and a configurable algorithm (default `SHA256`).
- `isValidSignature({ value, signature })` — recomputes the signature and compares.

## Rationale

### 1. Shared, consistent encoding

Centralizing the key encoding (hex), digest encoding (hex), and default algorithm in
one package guarantees that a payload signed by one service verifies correctly in
another. This interoperability is the main reason the wrapper must be shared rather
than copy-pasted.

### 2. Tiny, dependency-free primitive

The implementation is a thin wrapper over `node:crypto` with no runtime dependencies.
Packaging it separately keeps it reusable across any consumer without pulling in
unrelated code, and matches the one-responsibility-per-package convention used across
the monorepo.

## Consequences

- Any service needing HMAC integrity checks gets a consistent, tested implementation
  with a single dependency.
- The package is intentionally minimal — it exposes only string signing with a hex key.
  Consumers needing other key/digest encodings would need to extend it.

## Alternatives Considered

### Inline `crypto.createHmac` in each consumer

Rejected. Leads to subtle divergence in key/digest encoding and default algorithm
between services, which silently breaks cross-service signature verification.

### Bundle into `@beesolve/helpers`

Rejected. `helpers` is a grab-bag of generic utilities; HMAC signing is a focused,
security-relevant primitive that benefits from being an explicit, independently
versioned dependency.
