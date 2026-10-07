# @beesolve/lambda-function-url-protection

## 0.1.1

### Patch Changes

- 9924819: Relax `protectHandler`'s generic result type. The `Result` type parameter is no longer constrained to `APIGatewayProxyResult`, so handlers returning a v1 result, a v2 result, or a union of both compose without a cast. The wrapper's only introduced shape is the 403 proxy result, which is a valid v2 structured result.

## 0.1.0

### Minor Changes

- 394aeca: Initial release: fail-closed origin-token protection for Lambda Function URL behind CloudFront (protectFetch/protectHandler runtime wrappers + protectedFunctionUrlOrigin CDK helper).
