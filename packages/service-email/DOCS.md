# @beesolve/email-service - Documentation

**Keywords:** send email, transactional email, SES, Emails construct, Email, sendEmail, grantAccess, EventBridge, parseEmailEvent, bounce, complaint, React Email templates, hydrateTemplate

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/service-email

## How-To Guides

| Guide                                               | Description                                       |
| --------------------------------------------------- | ------------------------------------------------- |
| [Getting Started](./docs/how-to/getting-started.md) | Install, deploy the construct, send a first email |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                         | What it shows                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [authWithEmail](https://github.com/BeeSolve/packages/tree/main/packages/samples/authWithEmail) | Real email delivery of verification codes via the email service |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/service-email/docs) (GitHub only)
