# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Every serious project needs authentication and user management. The existing solutions on AWS fall into two categories:

1. **Managed services (Cognito, Auth0, Clerk, etc.)** — feature-rich, supporting OAuth, SAML, social login, MFA, and enterprise federation. Cognito is serverless and deeply integrated with AWS. These are the right choice for projects that need enterprise-grade identity features. However, they are opaque — you cannot read how they work internally, and when behavior is surprising you're limited to documentation and support tickets.

2. **SaaS auth providers (Auth0, Clerk, Stytch, etc.)** — excellent DX and feature sets, but charge per-user pricing that grows with your user base, and your user data lives on their infrastructure.

For small projects — personal tools, side projects, early-stage products — these solutions are often overkill. You don't need OAuth federation or SAML. You need "user logs in, gets a session, can access their stuff." You'd prefer to understand exactly how the auth works, pay only for actual AWS resource usage (which might be zero at free tier), and not depend on a third-party service for a critical path.

Additionally, passwords are a liability for everyone involved. Storing them means you need reset flows, breach detection, rotation policies, and you carry the risk of a credential leak. Users reuse passwords across services — a breach in your system affects them everywhere.

## Decision

Build a passwordless authentication service that is:

- **Intentionally simple** — email-code and passkey (WebAuthn) authentication only. No OAuth, no SAML, no social login, no enterprise federation. This is not a Cognito replacement — it's a simpler alternative for projects that don't need those features.
- **Fully serverless** — Lambda + DynamoDB + EventBridge, predictable cost that can stay within free tier for small projects.
- **Cookie-based** — sessions use `__Host-` prefixed HttpOnly cookies served behind the same domain as your application. No auth tokens exposed to client-side JavaScript, no token storage in localStorage.
- **Passwordless only** — the security responsibility shifts to the user's email provider (who invests millions into keeping passwords safe) and to hardware authenticators.
- **Transparent** — open source, you can read every line. You know exactly how sessions work, how tokens are generated, what's stored in DynamoDB.
- **Self-contained** — deploy a single CDK construct, get a working auth system. Works with CloudFront, API Gateway, and any SSR framework.
- **Event-driven** — emits events via EventBridge for email delivery, session lifecycle, and account creation. Bring your own email service (or use `@beesolve/email-service`), bring your own monitoring/logging.

## Rationale

### 1. Simplicity as a feature

Not every project needs OAuth flows, SAML integration, or social login. For a personal dashboard, an internal tool, or an early-stage product — "enter your email, get a code, you're in" is the entire auth story. This package does that well and nothing more.

### 2. Passwordless eliminates an entire class of problems

No password storage means no password resets, no breaches, no credential stuffing, no complexity requirements, no rotation policies. The attack surface shrinks dramatically.

### 3. Cookie-based auth is simpler and safer for web apps

With same-domain cookies, the browser handles credential transmission automatically. There's no token in localStorage for XSS to steal, no Authorization header for your SPA framework to manage, no refresh token rotation logic in client code.

### 4. Transparency

When you can read the session rotation logic, the cookie attributes, the DynamoDB schema — you can reason about security properties yourself. This matters for developers who want to understand their auth system, not just use it.

### 5. Cost scales to zero

A project with 10 users pays effectively nothing. Infrastructure cost is purely AWS resource usage (DynamoDB reads/writes, Lambda invocations) — no per-user fees from any service.

### 6. EventBridge decouples email and monitoring

The auth service doesn't know or care how emails are sent. It emits an event with the OTP code and metadata. This means you can use any email provider, any template system, any locale strategy — without forking the auth package.

## Consequences

- More operational responsibility than a managed service — you own the infrastructure, deployments, and monitoring.
- Passwordless-only is opinionated — projects that need password-based auth, OAuth, or SAML cannot use this.
- Not meant for enterprise — no federation, no social login, no compliance certifications (SOC 2, HIPAA) that managed services provide.
- Requires AWS and CDK knowledge to deploy (mitigated by samples and documentation).
- Cookie-based means same-domain only — no cross-domain auth for separate API domains (by design, this is a security property).
- The package must stay actively maintained since there's no vendor handling security patches.

## Alternatives Considered

### AWS Cognito

A valid choice for projects that need its feature set (OAuth, SAML, social login, enterprise federation). Not chosen here because it's more than small projects need, it's opaque, and the goal was a transparent, minimal auth system the author fully understands and controls.

### Auth0 / Clerk / other SaaS auth

Excellent products with per-user pricing models. Not chosen because for small projects the cost is unnecessary (AWS free tier is sufficient), user data lives on third-party infrastructure, and the feature set far exceeds what's needed.

### Roll auth per-project

Rejected. Even simple auth (sessions, cookies, CSRF protection, token lifecycle) is complex enough to justify a shared, well-tested package. Every project reimplementing this is a liability.
