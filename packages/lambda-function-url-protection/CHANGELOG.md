# @beesolve/lambda-function-url-protection

## 0.2.0

### Minor Changes

- 961fa96: Make origin-token enforcement opt-in by environment. `protectFetch` and `protectHandler` now enforce the token only when `ORIGIN_TOKEN` is set to a non-empty value; when it is unset or empty they pass the request through to the wrapped handler. Once enforcement is engaged it is still fail-closed (a missing or mismatched `x-origin-token` header is rejected with a 403). This lets a single handler be wrapped unconditionally and deployed behind both a token-protected Function URL origin and a non-token origin (such as an API Gateway origin). Supersedes the previous "reject when `ORIGIN_TOKEN` is unset" behavior (see ADR-002).

## 0.1.1

### Patch Changes

- 9924819: Relax `protectHandler`'s generic result type. The `Result` type parameter is no longer constrained to `APIGatewayProxyResult`, so handlers returning a v1 result, a v2 result, or a union of both compose without a cast. The wrapper's only introduced shape is the 403 proxy result, which is a valid v2 structured result.

## 0.1.0

### Minor Changes

- 394aeca: Initial release: fail-closed origin-token protection for Lambda Function URL behind CloudFront (protectFetch/protectHandler runtime wrappers + protectedFunctionUrlOrigin CDK helper).
