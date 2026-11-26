# ADR-005: Signed URLs Deferred

## Status

Deferred

## Context

imgix-style URLs are unauthenticated by default. Signing becomes necessary when the service accepts remote public image URLs, because the distribution could then be used as an open proxy. For images in the owner's own bucket, the main goal is that changing URL parameters just works, and size buckets (ADR-003) bound the cost of abuse.

## Decision

Do not implement signing in v1. The future design, verified by a deployed spike:

- Signature: HMAC-SHA256 over the path and the canonical query, in the `s` query parameter. Optional `expires` parameter, no expiry by default.
- The key lives only in a CloudFront KeyValueStore. The edge function reads it and verifies the signature. No Secrets Manager or SSM copy.
- A Node.js backend (not Bun) reads the same key with `@aws-sdk/client-cloudfront-keyvaluestore` and signs. Read the key once per cold start.
- Rotation: store several keys, verify against all, sign with the newest.

Verified facts (`eu-central-1`):

- A CloudFront Function (`cloudfront-js-2.0`) can read a KeyValueStore and compute `crypto.createHmac("sha256", key)` in one invocation. `test-function` reported compute utilization 8 out of 100 for one read plus one HMAC.
- A Node.js 24 arm64 Lambda reaches the KeyValueStore API. The API needs SigV4A. Without a signer the SDK throws "Neither CRT nor JS SigV4a implementation is available". `import "@aws-sdk/signature-v4a"` (pure JavaScript, no native module) fixes it. Bundled with `bun build --target node`, the handler was 1.65 MB.
- Measured from the Lambda (Lambda session credentials work): `DescribeKeyValueStore` 2,221 ms on the first call (includes SigV4A setup and TLS), `GetKey` 241 ms cold and 178 ms warm, `PutKey` 161 ms.
- Seeding from CDK: `cloudfront.KeyValueStore` with `source: ImportSource.fromInline(JSON.stringify({ data: [{ key, value }] }))` created the store with the key in place. The key is visible in the CloudFormation template. For a production secret use a custom resource calling `PutKey` after creation, or `ImportSource.fromAsset` (key stored in the CDK asset bucket). Both leave a copy, so a custom resource that generates the key at deploy time is preferred.
- Unverified: update of an existing key from CDK without exposing it, and KeyValueStore replication delay to the edge after `PutKey`.

## Rationale

### 1. Not needed for owner-owned images

The source is a single bucket the owner controls. The size-bucket mechanism limits the cost per request.

### 2. Needed for remote sources

For remote URLs the signature must be mandatory and unsigned requests must be rejected at the edge. That work also needs a host allow list and SSRF protection and is deferred together with signing.

## Consequences

- Anyone who knows the distribution URL can request any supported transformation of any object under the assets prefix. Operators who need access control should not use the construct for private images.
- Cache entries per image are not bounded in v1 (ADR-003 explains what the buckets do and do not bound).

## Alternatives Considered

### Secrets Manager or SSM copy of the key

Rejected. Two copies can drift, and the edge function cannot read them.

### Signing in v1

Rejected for scope. The URL helper would need a backend signer and key management before the service is useful.

## References

- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html
