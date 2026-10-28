# @beesolve/lint-config

Shared Oxlint configuration and custom lint rules for beesolve projects, plus a `bun fmt` config.

> [!WARNING]
> **Pre-1.0 — unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.

## Quick Setup

```bash
bun add -D oxlint oxlint-tsgolint nano-staged husky @beesolve/lint-config
bunx @beesolve/lint-config setup --type package --internal "@beesolve/*"
```

> Formatting uses `bun fmt` (built into Bun 1.4.4+), which reads the generated
> `.oxfmtrc.json`. No separate formatter package is installed.

### Project Types

| Type        | Use for                                           |
| ----------- | ------------------------------------------------- |
| `package`   | Library packages (this monorepo, standalone libs) |
| `monorepo`  | App monorepos with web                            |
| `sveltekit` | SvelteKit projects                                |

### Internal Pattern

Set `--internal` to match your workspace packages:

- `@beesolve/*` for shared packages repo
- `@app/*` for app monorepos

## What's Included

### Formatter (`bun fmt`)

Formatting is handled by [`bun fmt`](https://bun.com/docs/format) (Bun 1.4.4+),
configured via `.oxfmtrc.json` (which `bun fmt` reads natively):

- Trailing commas everywhere
- Double quotes
- 2-space indent, 100 char print width
- Import sorting (builtin → external → internal → relative)
- `package.json` key sorting

### Linter (Oxlint)

#### Native Rules

- `typescript/consistent-type-imports` — enforce `import type`
- `typescript/no-explicit-any` — warn
- `typescript/no-non-null-assertion` — warn
- `typescript/no-empty-object-type` — error
- `oxc/no-accumulating-spread` — warn

#### Type-Aware Rules (requires `oxlint-tsgolint`)

| Rule                            | Severity | Description                                                                   |
| ------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `consistent-type-exports`       | error    | Enforce `export type` for type-only exports                                   |
| `no-floating-promises`          | error    | Promises must be awaited, caught, or explicitly voided                        |
| `no-misused-promises`           | error    | Prevents passing async functions where sync callbacks are expected            |
| `await-thenable`                | error    | Catches `await` on non-Promise values                                         |
| `return-await`                  | error    | Requires `return await` inside try/catch, bare return otherwise               |
| `only-throw-error`              | error    | Only `Error` objects may be thrown                                            |
| `prefer-promise-reject-errors`  | error    | `Promise.reject()` must receive an Error                                      |
| `no-unnecessary-type-assertion` | warn     | Flags redundant `as X` casts                                                  |
| `no-unsafe-type-assertion`      | warn     | Flags narrowing type assertions                                               |
| `no-deprecated`                 | warn     | Flags usage of deprecated APIs                                                |
| `restrict-template-expressions` | warn     | Prevents interpolating objects/unknown in template literals (numbers allowed) |
| `no-base-to-string`             | warn     | Catches implicit `[object Object]` stringification                            |

#### Banned Syntax (`no-restricted-syntax`)

- **No enums** — use `as const` objects or union types
- **No switch** — use if-chains with early returns + `assertUnreachable()`
- **No `T[]`** — use `Array<T>`

#### Custom Rules (`beesolve/*`)

| Rule                       | Severity | Description                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `prefer-props-object`      | error    | Max 1 param per function. Exceptions: callbacks, constructors, 2 object params (handler pattern) |
| `valibot-namespace-import` | error    | Must use `import * as v from "valibot"`. Auto-fixable.                                           |
| `no-valibot-date`          | error    | Ban `v.date()`, use `v.isoTimestamp()`. Auto-fixable.                                            |
| `naming-conventions`       | error    | PascalCase for types/interfaces, camelCase/PascalCase for values.                                |
| `no-then-chains`           | error    | Ban `.then()` chains. Use `await` instead.                                                       |
| `readonly-props`           | warn     | Interface and type literal properties should be `readonly`.                                      |

### Presets

Presets extend `base.oxlintrc.json` and add project-specific ignore patterns.

| Preset      | Use for                                 | `internalPattern` |
| ----------- | --------------------------------------- | ----------------- |
| `package`   | Library packages (`@beesolve/packages`) | `@beesolve/*`     |
| `monorepo`  | App monorepos with tRPC/React           | `@app/*`          |
| `sveltekit` | SvelteKit projects                      | `@app/*`          |

#### Overriding rules per project

Add rule overrides in your project's `.oxlintrc.json`:

```jsonc
{
  "extends": ["./node_modules/@beesolve/lint-config/presets/monorepo.oxlintrc.json"],
  "rules": {
    "beesolve/readonly-props": "off",
  },
}
```

#### Adding project-specific custom rules

Create a local plugin file and reference it:

```jsonc
{
  "extends": ["./node_modules/@beesolve/lint-config/presets/monorepo.oxlintrc.json"],
  "jsPlugins": ["./lint/my-project-rules.js"],
}
```

### Pre-commit (nano-staged + husky)

Runs on staged files before commit:

- `bun fmt` on all files
- `oxlint` on `.js/.ts/.jsx/.tsx` files

## Conventions (Not Lint-Enforced)

These are documented conventions; follow them in code review:

1. **Date string comparison**: Use `localeCompare()` for comparing ISO date strings, not `>` / `<`.

2. **Schema-first types**: Define valibot schemas at boundaries, infer types with `v.InferOutput<typeof schema>`. Don't manually write types that duplicate schema shapes.

3. **File naming** (planned rule): Prefer flat directories with inverse naming:
   - `userOne.ts`, `userMany.ts`, `user.ts` instead of `user/one.ts`, `user/many.ts`
   - camelCase filenames only
   - Test files: `entityAction.test.ts`

4. **Classes**: Avoid unless required by framework (SvelteKit) or boundary pattern (repository). Suppress lint warning inline when justified.

## Manual Configuration

If you don't use the setup script, reference configs directly:

`.oxlintrc.json`:

```json
{
  "extends": ["./node_modules/@beesolve/lint-config/presets/package.oxlintrc.json"]
}
```

`.nano-staged.json`:

```json
{
  "*": "bun fmt --no-script",
  "**/*.{js,ts,jsx,tsx}": "oxlint"
}
```

## Adding Custom Rules

Edit `plugins/beesolve.js`. Rules use the standard ESLint plugin API (ESLint v9 compatible) and run inside Oxlint's JS plugin runtime.

See: https://oxc.rs/docs/guide/usage/linter/writing-js-plugins

## Editor Setup — Zed

1. Install the [Oxc extension](https://zed.dev/extensions/oxc) in Zed (for oxlint
   diagnostics and auto-fix)
2. Add to your Zed settings (`~/.config/zed/settings.json` or project `.zed/settings.json`):

```jsonc
{
  "formatter": {
    "external": {
      "command": "bun",
      "arguments": ["fmt", "--no-script", "--stdin-filepath", "{buffer_path}"],
    },
  },
  "format_on_save": "on",
  "code_actions_on_format": {
    "source.fixAll.oxc": true,
  },
}
```

This gives you:

- Format on save via `bun fmt` (uses `.oxfmtrc.json` from project root)
- Auto-fix oxlint errors on save via `source.fixAll.oxc`

`bun fmt` formats from stdin and needs no global install beyond Bun 1.4.4+.
