# BUG-001: SvelteKit + TypeScript 7 fails to emit types correctly

## Status: Open (version locked to TypeScript 6)

## Date Discovered: 2026-08-13

## Package

`@sveltejs/kit` — when used with TypeScript 7 (`typescript@^7.0.0`)

## Symptom

When running `svelte-check` or building the SvelteKit project with TypeScript 7:

- Generated `$types.d.ts` files in `.svelte-kit/types/` have incorrect or missing type information
- Page load functions show type errors like `Property 'token' does not exist on type '{}'`
- `$props()` types in `.svelte` files don't correctly infer from `+page.ts` / `+page.server.ts` load functions

## Root Cause

SvelteKit's type generation (via `svelte-kit sync`) relies on TypeScript's declaration emit behavior. TypeScript 7 changed how certain types are emitted, particularly around inferred return types from functions. This causes the generated `.svelte-kit/types/*/$types.d.ts` files to produce `{}` instead of the correct page data types.

This affects the `PageData`, `LayoutData`, and `PageLoad`/`PageServerLoad` type inference chain.

## Reproduction

1. Have a SvelteKit project with a `+page.ts` that exports a `load` function returning data
2. Use `typescript@^7.0.0` in the project
3. Run `svelte-kit sync`
4. Open a `.svelte` file that uses `let { data } = $props()` — `data` will be typed as `{}`
5. Or access `data.token` and get: `Property 'token' does not exist on type '{}'`

## Workaround (current)

Lock TypeScript to version 6 in the project's `package.json`:

```json
{
  "devDependencies": {
    "typescript": "^6.0.0"
  }
}
```

This ensures SvelteKit's type generation works correctly.

**IDE note:** In a monorepo where the root has TypeScript 7, the IDE's TypeScript language server may pick up the root TS7 instead of the local TS6 — causing `$props()` to show as `any` in the editor even though `svelte-check` and `vite build` work correctly. To fix this in the IDE, configure the TypeScript workspace version to point to the package's local `node_modules/typescript`.

## Monitoring Action

### When to retry

After SvelteKit releases a new version that explicitly supports TypeScript 7, or after TypeScript 7 fixes the declaration emit behavior that breaks SvelteKit's type generation.

Watch:

- https://github.com/sveltejs/kit/issues (search for "TypeScript 7" or "TS7")
- SvelteKit release notes mentioning TypeScript 7 compatibility

### Test procedure

1. Change `"typescript": "^6.0.0"` to `"typescript": "catalog:"` (which resolves to TS7)
2. Run `bun install`
3. Run `bunx svelte-kit sync`
4. Run `svelte-check --tsconfig ./tsconfig.json`
5. Verify that page data types resolve correctly (no `{}` type for data props)

### Resolution criteria

- `svelte-check` passes without type errors related to page data inference
- `$props()` correctly infers types from load functions in `.svelte` files
- Both conditions met → switch back to `"typescript": "catalog:"`, mark this bug as fixed

## Upstream

This is likely a compatibility issue between SvelteKit's type generation and TypeScript 7's new declaration emit behavior. The fix would require the SvelteKit team to update their type generation to work with TS7's emit changes.
