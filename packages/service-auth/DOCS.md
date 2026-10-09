# @beesolve/auth-service - Documentation

**Keywords:** authentication, sign-in, email code, OTP, passkey, session, cookie, `__Host-SID`, AuthGateway, AuthService, createSessionHandle, createInProcessSessionHandle, SessionAuthorizer, getSessionContext, AuthClient, impersonation, data token, EventBridge, EmailCodeAuth, CloudFront, WAF, SvelteKit, CDK

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/service-auth

## How-To Guides

| Guide                                                                                         | Description                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [Getting Started](./docs/how-to/getting-started.md)                                           | Install, CDK setup, SvelteKit, first deployment  |
| [CloudFront](./docs/how-to/cloudfront.md)                                                     | Serving the auth service behind CloudFront       |
| [Consuming Events](./docs/how-to/consuming-events.md)                                         | Reacting to auth events on EventBridge           |
| [Data Token](./docs/how-to/data-token.md)                                                     | Anonymous-to-authenticated session data handoff  |
| [DLQ Alarms Warning](./docs/how-to/dlq-alarms-warning.md)                                     | Resolve the "No alarms configured" synth warning |
| [Local Development with kit-on-lambda](./docs/how-to/local-development-with-kit-on-lambda.md) | Running the SvelteKit integration locally        |
| [WAF](./docs/how-to/waf.md)                                                                   | Rate limiting the auth endpoints with AWS WAF    |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                                     | What it shows                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [authEmailSimple](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple)         | Minimal email code auth with in-process session validation in SvelteKit hooks |
| [authEmailAuthorizer](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailAuthorizer) | Same flow using an API Gateway Lambda authorizer via `createSessionHandle()`  |
| [authWithEmail](https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithEmail)             | Full email code auth with real email delivery, resend, and sign-out           |
| [authWithPasskeys](https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithPasskeys)       | Email code auth with passkey (WebAuthn) support                               |
| [authCookieFunction](https://github.com/BeeSolve/packages/tree/main/packages/samples/authCookieFunction)   | Authorizer + `ensureCookieFunction` pattern with caching disabled             |
| [authSpaWithApi](https://github.com/BeeSolve/packages/tree/main/packages/samples/authSpaWithApi)           | React SPA with a tRPC API protected by the Lambda authorizer                  |
| [authImpersonation](https://github.com/BeeSolve/packages/tree/main/packages/samples/authImpersonation)     | Operator-less session impersonation with an audit consumer                    |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/service-auth/docs) (GitHub only)
