# TypeScript Overrides — @beesolve/packages

## Workflow

- Always start with `git pull --rebase origin main` before making any changes

## Runtime

- Packages target both Bun and Node.js consumers
- Use `bun test` for testing
- Scripts use Bun APIs (`Bun.file`, `Bun.spawn`, etc.)

## Barrel Exports

- Use barrel exports (`index.ts`) for package public APIs — this is the only repo where barrel exports are allowed

## Linting & Formatting

- Formatter: Oxfmt (`bun run fmt` / `bun run fmt:check`)
- Linter: Oxlint (`bun run lint`) with custom rules via `@beesolve/lint-config`
- Pre-commit: nano-staged + husky (auto-runs oxfmt + oxlint on changed files)
- Config lives in `packages/lint-config/` — shared across all beesolve projects

## Monorepo

- Workspaces with `catalog:` for shared dependency versions
- Use `workspace:^` for intra-monorepo dependencies
- Changesets for versioning and publishing

## Changesets

- Package names do NOT match directory names. Always read `package.json` `name` field before creating changesets.
- Known mappings:
  - `packages/service-email/` → `@beesolve/email-service`
  - `packages/service-auth/` → `@beesolve/auth-service`
  - `packages/sqs-handler/` → `@beesolve/sqs-handler`
  - `packages/lambda-fetch-api/` → `@beesolve/lambda-fetch-api`
  - `packages/lint-config/` → `@beesolve/lint-config`
  - `packages/cdk-constructs/` → `@beesolve/cdk-constructs`
  - `packages/helpers/` → `@beesolve/helpers`
  - `packages/action-tokens/` → `@beesolve/action-tokens`
  - `packages/lambda-keep-active/` → `@beesolve/lambda-keep-active`

## Build

- Build tool: bunup
- Publish in topological order via `scripts/publish.ts`
