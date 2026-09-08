# SvelteKit + kit-on-lambda — Known Issues

## UI Components — Graffiti First (mandatory)

The dashboards use the `@drop-in/graffiti` design system (imported via `import "@drop-in/graffiti"`). Graffiti is the single source of truth for UI.

- **Always use a graffiti component or utility class when one exists** for what you are building — cards, stat cards, chips/tags, dialogs, drawers, dropdown menus, tabs, pagination, breadcrumbs, tooltips, avatars, toggle switches, timelines/steps, and layout utilities (Stack, Cluster, Card Grid, Surface, Readable, App Shell, Reel/Carousel, Table wrapper). Compose the graffiti class in the markup; do not re-implement it in a component `<style>` block.
- **Only hand-roll a component when graffiti has no suitable equivalent** (e.g. a calendar/date-picker, a bar chart). When you must hand-roll, build on graffiti design tokens (`--fg-*`, `--bg`, `--pad-*`, `--vs-*`, `--br-*`, `--border-*`, semantic colors) rather than hardcoded values.
- **Never hand-roll a class name that collides with a graffiti global class** (e.g. `.timeline`, `.card`, `.tag`). Graffiti's global rules will apply to your element and fight your scoped CSS. Use a distinct class name or, preferably, adopt the graffiti component.
- Custom `<style>` should be limited to: semantic tinting via component variables (e.g. `--tag-color`), small layout scaffolding graffiti does not provide, and genuine gaps. Prefer extending graffiti over overriding it.
- Before writing new component CSS, check `node_modules/@drop-in/graffiti/dist/index.css` (or https://graffiti-ui.com) for an existing component. If it exists, use it.

## Vite SSR Externals

When using `@beesolve/lambda-fetch-api` in SvelteKit hooks (e.g. `createSessionHandle()`), the vite config **must** externalize it:

```ts
ssr: {
  external: ["@beesolve/lambda-fetch-api"],
},
```

Without this, Vite creates a duplicate `AsyncLocalStorage` instance — the handler and hooks use different stores, causing "getAws* called outside of a handler invocation" errors at runtime.

This affects `createSessionHandle()` (authorizer pattern). `createInProcessSessionHandle()` is unaffected.

## CDK identitySource for Disabled Cache

When setting `authorizerCache: "disabled"` on `AuthGateway`, the `identitySource` must be `[]` (empty array), not `undefined`. Passing `undefined` makes CDK use the default (`$request.header.Authorization`), which causes API Gateway to return 401 without ever invoking the authorizer Lambda.

## Named Form Actions and CloudFront/Lambda

SvelteKit named form actions use `?/actionName` in the URL (e.g. `?/verify`). The `/` in the query parameter causes issues with CloudFront and Lambda — the request gets rejected or misrouted. Solutions:

- Use the **default** form action (no name) instead of named actions
- Or encode the `/` in the query parameter (e.g. `?%2Fverify`)

This applies to any SvelteKit app deployed behind CloudFront via kit-on-lambda.

## First Deployment (Chicken-and-Egg)

Sample stacks require a `FRONTEND_URI` env var (the CloudFront URL) which doesn't exist until after first deploy. Workflow:

1. Set a placeholder URL in `mise.toml`
2. Deploy — note the CloudFront URL from CDK output
3. Update `mise.toml` with the real URL and redeploy

## Service Instantiation Pattern

All shared services (DynamoDB clients, SDK clients, domain models) must be created once in `hooks.server.ts` and passed to routes via `event.locals`. Route files (`+page.server.ts`, `+layout.server.ts`) must **never** instantiate their own DynamoDB clients, SDK clients, or service classes.

This ensures:

- A single DynamoDB connection is reused across the request lifecycle
- No duplicate env parsing or client construction in each route
- Consistent service configuration in one place
- Easier testing and mocking

```ts
// hooks.server.ts — create services here
const users = new Users({
  dynamo,
  tableName: env.DMARC_TABLE_NAME,
  reverseIndexName: env.DMARC_REVERSE_INDEX,
});
event.locals.services = { users, domains, reports, setup, authClient };

// +page.server.ts — access services directly (no destructuring)
export const load: PageServerLoad = async ({ locals }) => {
  const allDomains = await locals.services.domains.list();
  // ...
};
```
