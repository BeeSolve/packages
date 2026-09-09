# ADR-007: Replace Origin Verification Token with CloudFront OAC

## Status

Accepted

## Date

2026-05-31

## Context

The auth Lambda function URL is currently protected by a shared secret (`x-origin-token`) passed as a custom origin header from CloudFront. The Lambda handler validates this token on every request and returns 403 if it doesn't match.

This approach has several weaknesses:

1. **Lambda is still invoked on direct access.** Anyone who discovers the function URL can hit it directly. The Lambda executes, reads the token from environment, compares it, and returns 403. This costs money and inflates invocation/error metrics.

2. **Secret management overhead.** A Secrets Manager secret is created, its value injected into the Lambda environment, and the consumer must wire it as a custom origin header in their CloudFront distribution. This is manual, error-prone, and adds a secret to rotate.

3. **No IAM-level enforcement.** The protection is purely application-level. There is no AWS-native access control preventing invocation — the function URL auth type is `NONE`.

4. **SecurityHub findings.** Lambda functions with public URLs (`AuthType: NONE`) trigger SecurityHub control Lambda.1 warnings, requiring suppression or remediation.

## Decision

Replace the origin verification token with **CloudFront Origin Access Control (OAC)** for the Lambda function URL.

- Set the function URL `AuthType` to `AWS_IAM`.
- Create a CloudFront OAC (origin type: `lambda`, signing: `always`, protocol: `sigv4`).
- Use a **Lambda@Edge** function (origin-request, `includeBody: true`) to compute the `x-amz-content-sha256` header required for POST requests.
- Remove the Secrets Manager secret and all token validation code.

## Consequences

### Positive

- **No Lambda invocation on direct access.** AWS IAM rejects unsigned/unauthorized requests before the function executes. Zero cost, zero noise in metrics.
- **No secrets to manage.** OAC signing is handled entirely by CloudFront using AWS-managed credentials. No rotation, no environment variables, no Secrets Manager cost.
- **Simpler consumer setup.** Consumers attach the origin and edge function to their CloudFront distribution — no custom headers to configure.
- **SecurityHub compliant.** `AuthType: AWS_IAM` satisfies Lambda.1 without suppression.
- **Defense in depth.** IAM-level enforcement + WAF + CloudFront, rather than relying on application code.

### Negative

- **Lambda@Edge dependency.** A small Lambda@Edge function must deploy to us-east-1 and is associated with the CloudFront distribution. This adds a cross-region resource and slightly complicates teardown (replicated functions have a deletion delay).
- **1 MB body size limit.** Lambda@Edge origin-request events expose at most 1 MB of the request body. This is irrelevant for auth payloads (< 5 KB) but would matter if the pattern were reused for file uploads.
- **Breaking change.** The `originVerificationToken` property is removed from the construct's public API. Consumers must update their CloudFront distributions to use OAC instead of the custom header. Requires a major version bump.
- **CORS handling moves to CloudFront.** With `AWS_IAM` auth type, CORS headers configured on the function URL may be stripped. CORS must be handled at the CloudFront behavior level.

## Alternatives Considered

### Keep origin token (status quo)

Rejected. Lambda still invoked on direct access, secret management overhead, SecurityHub warnings.

### CloudFront Functions for body hashing

Rejected. CloudFront Functions cannot access the request body — impossible to compute `x-amz-content-sha256` for POST requests.

### Client-side `x-amz-content-sha256` header

Rejected. Requires browser clients to compute SHA-256 of the POST body and include it as a header. This leaks infrastructure concerns into frontend code and breaks the "automated, no user action required" premise.

### API Gateway in front of Lambda

Rejected. Adds another service (cost, latency, configuration) when the function URL + OAC achieves the same goal with fewer moving parts.
