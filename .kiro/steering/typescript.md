# TypeScript Overrides — @beesolve/packages

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

## Build

- Build tool: bunup
- Publish in topological order via `scripts/publish.ts`
