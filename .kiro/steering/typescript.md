# TypeScript Overrides — @beesolve/packages

## Runtime

- Packages target both Bun and Node.js consumers
- Use `bun test` for testing
- Scripts use Bun APIs (`Bun.file`, `Bun.spawn`, etc.)

## Barrel Exports

- Use barrel exports (`index.ts`) for package public APIs — this is the only repo where barrel exports are allowed

## Monorepo

- Workspaces with `catalog:` for shared dependency versions
- Use `workspace:^` for intra-monorepo dependencies
- Changesets for versioning and publishing

## Build

- Build tool: bunup
- Publish in topological order via `scripts/publish.ts`
