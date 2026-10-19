# Lambda Function URL Protection

Fail-closed origin-token protection for a Lambda Function URL behind CloudFront. A secret is generated and sent as the `x-origin-token` header from CloudFront, injected into the handler as `ORIGIN_TOKEN`, and verified at runtime so the Function URL cannot be invoked directly, bypassing the distribution.

> [!WARNING]
> **Pre-1.0 — unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

## Installation

```bash
npm i @beesolve/lambda-function-url-protection
```

## API

CDK side (the `.` export):

- `protectedFunctionUrlOrigin(props)` - generates the secret, injects `ORIGIN_TOKEN`, creates the Function URL, and returns a CloudFront origin that sends the `x-origin-token` header.
- `ProtectedFunctionUrlOriginProps` - props for the helper (`handler`, optional `invokeMode`, optional `allowedOrigins`).

Runtime side (the `./runtime` export):

- `protectFetch(fetch)` - wraps a `Fetch` handler, rejecting requests without a matching token with a 403.
- `protectHandler(handler)` - wraps a Lambda proxy handler, rejecting events without a matching token with a 403.

See [DOCS.md](./DOCS.md) for how-to guides.
