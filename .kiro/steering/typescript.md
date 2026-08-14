# TypeScript Overrides — @beesolve/packages

## Workflow

- Always start with `git pull --rebase origin main` before making any changes
- Never push without explicit user approval — always show the diff and wait for confirmation before `git push`

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
  - `packages/dmarc-parser/` → `@beesolve/dmarc-parser`
  - `packages/dmarc-reports/` → `@beesolve/dmarc-reports`
  - `packages/dmarc-consumer/` → `@beesolve/dmarc-consumer`

## Build

- Build tool: bunup
- Publish in topological order via `scripts/publish.ts`

## DynamoDB

- Always pass marshall options when creating `DynamoDBDocumentClient`:
  ```ts
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(), {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
  });
  ```
- When using `ConditionExpression: "attribute_not_exists(...)"` to prevent overwrites on a table with a composite key (pk + sk), always check BOTH key attributes:
  ```ts
  ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)";
  ```
  Using only `attribute_not_exists(pk)` would prevent writing items with the same pk but different sk values.

## Valibot

- For string literal unions, use `v.picklist` with an `as const` array — never `v.union([v.literal(...), ...])`:
  ```ts
  // Correct
  export const userTypes = ["admin", "user"] as const;
  export type UserType = (typeof userTypes)[number];
  v.object({ type: v.picklist(userTypes) });

  // Wrong — do not use v.union for string literal sets
  const userType = v.union([v.literal("admin"), v.literal("user")]);
  ```
- Reserve `v.union` for unions of different types (objects, numbers, mixed schemas)
