# ADR-001: Why This Package Exists

## Status

Accepted

## Context

A Lambda Function URL created with `authType` set to `NONE` is publicly reachable by anyone who discovers it. A common way to keep such a function private is to put CloudFront in front of it and have the distribution forward a shared secret: generate a secret, inject it into the handler as the `ORIGIN_TOKEN` environment variable, and have CloudFront send it on every origin request as the `x-origin-token` header.

That wiring only helps if the handler actually verifies the header. When nothing checks it at runtime, the handler receives the token but never compares it, so the Function URL can still be invoked directly, bypassing everything CloudFront puts in front of the Lambda: a basic-auth viewer function, caching, and WAF. The injected secret is then decorative - it exists on both sides of the wire but is never compared.

The verification has two halves that must agree: the CDK side that generates the secret and wires up the header and environment variable, and the runtime side that reads them back and rejects mismatches. If those two halves use different header names or env var names, the contract silently breaks and every request is either always allowed or always rejected.

## Decision

Own both halves of the token contract in one standalone package:

- A runtime wrapper (`protectFetch` for `Fetch` handlers, `protectHandler` for Lambda proxy handlers) that rejects any request whose `x-origin-token` header does not match the `ORIGIN_TOKEN` value, when enforcement is engaged (see ADR-002 for when it engages).
- A CDK helper (`protectedFunctionUrlOrigin`) that generates the secret, injects `ORIGIN_TOKEN` into the handler, creates the Function URL, and returns a CloudFront origin that sends the `x-origin-token` header.
- Shared header and env-var constants (`originTokenHeader`, `originTokenEnvVar`) consumed by both halves so the names cannot drift apart.

## Rationale

### 1. Enforcement is opt-in by environment, fail-closed once engaged

The runtime wrappers enforce the token only when `ORIGIN_TOKEN` is set to a non-empty value. When it is unset or empty, the request is passed through. Once enforcement is engaged, it is fail-closed: a missing or mismatched header is rejected with a 403, never allowed through. See ADR-002 for why this supersedes the original "fail-closed only, reject when unconfigured" stance.

### 2. Constant-time comparison

Tokens are compared with `node:crypto`'s `timingSafeEqual`, guarded by a length check first (`timingSafeEqual` throws on unequal-length buffers). Comparing with `===` would leak information about how many leading characters match through response timing, making the secret easier to recover byte by byte.

### 3. A helper, not a Construct

`protectedFunctionUrlOrigin` is a plain function returning a CloudFront origin, not a `Construct` subclass, and it exposes no "auth mode" option to disable protection. Protection is the only behavior. Consumers who genuinely need an unprotected or differently-authenticated origin override `toDefaultOrigin` instead - that override is the escape hatch, so the helper itself never has to carry a bypass flag that could be left on by accident.

### 4. One package owns both halves

The CDK side and the runtime side share `originTokenHeader` and `originTokenEnvVar` from a single module. Because the same constants back both the header CloudFront sends and the header the handler reads, the contract cannot drift. Splitting the two halves across separate packages (or inlining one half elsewhere) would reintroduce the risk of mismatched names.

## Consequences

- Direct invocation of the Function URL, bypassing CloudFront, is rejected with a 403. The protection that the injected secret always implied is now actually enforced.
- The header and env-var contract lives in one place, so the CDK and runtime halves stay in sync by construction.
- Consumers who front the Lambda with an API Gateway origin or authorizer rather than the token-protected Function URL do not set `ORIGIN_TOKEN`, so the wrappers pass requests through and the check never fires. The same handler file can therefore serve both a token-protected Function URL origin and a non-token origin without branching (see ADR-002).
- The protection is independent of the Function URL response mode. The same token check works for both streamed (`InvokeMode.RESPONSE_STREAM`) and buffered (`InvokeMode.BUFFERED`) responses, because `protectFetch` and `protectHandler` wrap the handler regardless of how its response is delivered.
- keep-active pings invoke the Lambda directly and carry no origin token. Ordering therefore matters: the keep-active wrapper must run before the protection wrapper so a ping short-circuits before the token check rejects it (see the getting-started guide).

## Alternatives Considered

### AWS_IAM Function URL auth with CloudFront OAC

Use `FunctionUrlAuthType.AWS_IAM` and let CloudFront's Origin Access Control sign requests, instead of a shared bearer token. Rejected because, at the time of writing, CloudFront OAC signing for Lambda Function URLs does not cover streaming responses cleanly and complicates local and non-CloudFront invocation. A shared token is transport-agnostic, works identically for buffered and streaming responses, and keeps the verification logic in application code where it can be tested directly.

### Inline the verification in the consuming adapter

Add the runtime check and the header wiring directly inside the Lambda adapter or framework that consumes this contract, rather than shipping a standalone package. Rejected because the two halves of the contract would then be entangled with unrelated framework code, harder to test in isolation, and impossible to reuse for a plain Lambda proxy handler that is not built on that framework. A standalone package with a narrow surface keeps the contract self-contained and independently versioned.
