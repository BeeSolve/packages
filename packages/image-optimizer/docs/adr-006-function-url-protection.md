# ADR-006: Function URL Protected by CloudFront Origin Access Control

## Status

Accepted

## Context

The image function is invoked through a Lambda Function URL behind CloudFront. Calls that bypass CloudFront would skip the edge canonicalization, the 400 responses for unsupported parameters and the cache, so every call would cost a Lambda invocation. Two ways to keep the Function URL private were evaluated: CloudFront origin access control (OAC) with `AuthType AWS_IAM`, and the origin token of `@beesolve/lambda-function-url-protection`.

## Decision

Use OAC. The Function URL uses `AuthType AWS_IAM` and `InvokeMode.RESPONSE_STREAM`, and the distribution uses `FunctionUrlOrigin.withOriginAccessControl`.

## Rationale

### 1. Verified on the Bun runtime

In the Task 1 spike OAC worked with a buffered Function URL. In the deployed sample (`SamplesImageOptimizer`, runtime 4.10405.1) it works with the streaming Function URL: status codes and headers set by `asResponseStreamHandler` reach the viewer, and a direct call to the Function URL returns 403.

### 2. No secret to manage

OAC needs no shared secret, no environment variable and no check in the handler. The origin token needs a generated secret and a runtime check that must not be forgotten.

### 3. Rejected before the function runs

An unsigned request is rejected by Lambda itself, so it costs no invocation. The origin token is checked inside the handler, after the invocation has started.

## Consequences

- Only GET and HEAD are allowed on the behaviors, so OAC does not need the payload hash header that request bodies require.
- The origin read timeout is the function timeout plus 5 seconds (at most 120).

## Alternatives Considered

### `@beesolve/lambda-function-url-protection`

Rejected for this package. It is the right choice where OAC is not available, but here OAC works and needs fewer moving parts.
