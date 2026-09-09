# ADR-003: Pre-build email templates instead of runtime rendering

## Status

Accepted

## Context

`@beesolve/email-service` needs to send HTML emails with dynamic content (user name, OTP codes, links, localized text). The question is whether to render React Email templates at runtime inside the Lambda handler, or pre-render them at build time and hydrate with runtime values.

## Decision

Templates are rendered to static HTML/text at build time using `buildTemplates()`. At runtime, the Lambda calls `hydrateTemplate()` to replace `$$$__KEY__$$$` placeholders with real values. React and `@react-email` are dev dependencies only — they are never in the Lambda bundle.

## Rationale

### 1. Bundle size and cold start

React (`react` + `react-dom`) adds ~3MB. The `@react-email/components` package and its transitive dependencies (including CSS inlining) add another ~2MB. A 5MB+ addition to a Lambda bundle significantly worsens cold-start latency — particularly on 256MB-512MB memory configurations typical for email-sending Lambdas.

By pre-building, the Lambda receives only the rendered HTML strings (a few KB per template) and a lightweight `hydrateTemplate` function (~50 lines, no dependencies).

### 2. Deterministic output

Pre-building means the HTML is fixed at deploy time. There are no version drift issues between React versions producing subtly different HTML across deployments. Email client rendering is notoriously sensitive to minor HTML changes — deterministic output reduces the risk of visual regressions.

### 3. Build-time validation

Running `buildTemplates` during CI catches template errors (missing props, invalid JSX, broken imports) before deployment. Runtime rendering would surface these errors only when the first email is sent.

### 4. Multi-locale as first-class

The build step generates one JSON file per template × locale combination. At runtime, picking the right locale is a simple import/lookup — no locale-aware rendering logic needed in the handler.

## Consequences

- **Build step required:** Consumers must run `buildTemplates()` before bundling the Lambda. This adds a step to the deploy pipeline.
- **No dynamic template logic:** Templates cannot contain runtime conditionals that depend on values unknown at build time (e.g. "show section X if user has feature flag Y"). All dynamic content must go through placeholder substitution.
- **Local preview still works:** The `@react-email` CLI (`bunx email dev`) renders templates locally with `PreviewProps` — this is unaffected since it runs outside Lambda.
- **Inline rendering available for dev:** `renderEmail()` is exported for local development and testing, but documented as not suitable for production Lambdas.

## Alternatives Considered

### Runtime rendering in Lambda

Bundle React and render templates on every send. Rejected due to cold-start impact and bundle size. A Lambda that sends a single email should not ship 5MB of rendering infrastructure.

### Edge-side rendering (Lambda@Edge / CloudFront Functions)

Not applicable — email rendering happens server-to-server (SES), not at the CDN edge.

### String template literals (no React)

Use tagged template literals or Handlebars for email HTML. Rejected because React Email provides a component model with tested cross-client compatibility, responsive layouts, and the `@react-email` preview server. The pre-build pattern gives us React Email's authoring DX without the runtime cost.
