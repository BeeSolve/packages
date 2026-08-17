# ADR-001: Why This Package Exists

## Status

Accepted

## Context

The `@beesolve` packages are infrastructure libraries — CDK constructs, Lambda adapters, auth services, email services. Understanding how to use them from a README alone is difficult:

- READMEs document API surface, not integration patterns
- Real usage requires wiring multiple packages together (auth + email + CDK + frontend)
- Edge cases and deployment gotchas only surface when you actually deploy
- Copy-pasting README snippets into a real project often fails due to missing context (imports, configuration, environment variables)

For developers evaluating whether to adopt these packages, there's a gap between "I've read the docs" and "I understand how to integrate this into my project."

For us as package authors, there's also no way to verify that our packages actually compose correctly without a real deployment target.

## Decision

Maintain a `samples` package containing complete, deployable example stacks that demonstrate real integration patterns:

- Each sample is a full working application (frontend + infrastructure) that can be deployed with a single command
- Samples use multiple `@beesolve` packages together, showing how they compose
- The package is `private: true` — not published to npm, exists only in this monorepo

## Rationale

### 1. Show, don't tell

A working deployment is unambiguous. A README can be misinterpreted, but `bun run deploy:authWithPasskeys` either works or it doesn't. Samples serve as executable documentation.

### 2. Integration testing for package authors

Samples function as integration tests. When we change `@beesolve/auth-service` internals, we can deploy the sample stacks to verify nothing broke at the integration boundary. This catches issues that unit tests within individual packages cannot — configuration mismatches, missing exports, CDK synth failures.

### 3. Adoption path for new users

A developer evaluating the auth service can clone this repo, deploy a sample stack, see it working, then adapt it. This is significantly faster than assembling a project from API documentation.

### 4. Composition patterns are the hard part

Individual packages have clear APIs. The challenge is wiring them together: how does auth-service connect to email-service? How does the CDK stack structure look? What environment variables does each Lambda need? Samples answer these questions by example.

## Consequences

- Samples must stay up-to-date with package changes — a breaking change in any `@beesolve` package should be caught here first.
- Each sample adds deployment cost when tested (AWS resources). Mitigated by using serverless resources and destroying stacks after verification.
- The package depends on every other `@beesolve` package via `workspace:^` — it's always at the top of the dependency graph.
- Samples are not published and not versioned independently. They track `main` branch of all packages.

## Alternatives Considered

### Separate example repository

Rejected. A separate repo would quickly fall out of sync with package changes. Keeping samples in the same monorepo means they are always tested against the latest code and break visibly in CI when packages change.

### Only provide README documentation

Rejected. READMEs are necessary but insufficient. Integration patterns, CDK wiring, and multi-package composition are too complex to convey through API documentation alone. Developers need working code they can deploy and inspect.
