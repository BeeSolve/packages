# @beesolve/action-tokens - Documentation

**Keywords:** action token, one-time token, OTP, email verification, magic link, create token, validate token, throttle, rate limit, ActionTokens, ActionTokensClient, createNew, createNewWithThrottling, use, peek, drain, grantAccess, TokenDoesNotExistError, ExpiredTokenError, TokenAlreadyUsedUpError, TokenInvalidError, TokenThrottledError, DynamoDB, CDK construct

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/action-tokens

## How-To Guides

| Guide                                               | Description                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Getting Started](./docs/how-to/getting-started.md) | Install, wire the CDK construct and `grantAccess`, create and validate a first token                          |
| [Throttling](./docs/how-to/throttling.md)           | Use `createNewWithThrottling` to block abuse, handle `TokenThrottledError`, pick throttle identity vs. window |
| [Error Handling](./docs/how-to/error-handling.md)   | Handle every token error type with a complete pattern around a `use()` call                                   |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                     | What it shows                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [emailVerify](https://github.com/BeeSolve/packages/tree/main/packages/samples/emailVerify) | Standalone email verification form using action tokens directly, no auth system |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/action-tokens/docs) (GitHub only)
