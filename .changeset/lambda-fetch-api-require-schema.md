---
"@beesolve/lambda-fetch-api": major
---

Remove schema-less overloads from `getAwsLambdaAuthorizerContext` and `getAwsCustomAuthorizerContext`

Schema argument is now always required — the no-argument overload that returned untyped `unknown` has been removed. This enforces type-safe access to authorizer payloads.

Other changes:

- Refactored `parseWithSchema` to use named object parameter
- Moved private helpers below exports
- Removed `export type { StandardSchemaV1 }` re-export (import directly from `@standard-schema/spec`)
