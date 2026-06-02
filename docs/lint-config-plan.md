# Implementation Plan: `@beesolve/lint-config`

Migrate from Biome to Oxlint + Oxfmt with a shareable config package, nano-staged pre-commit hooks, and custom lint rules enforcing beesolve conventions.

## Package Structure

```
packages/lint-config/
├── package.json
├── index.ts                          # re-exports for programmatic use
├── oxfmt.json                        # base formatter config
├── presets/
│   ├── base.oxlintrc.json            # shared rules (all project types)
│   ├── package.oxlintrc.json         # library packages (@beesolve/packages)
│   ├── monorepo.oxlintrc.json        # app monorepos (expense-ease)
│   └── sveltekit.oxlintrc.json       # SvelteKit projects (admin.barlogova.sk)
├── plugins/
│   ├── beesolve.js                   # all custom rules in one plugin
│   └── README.md                     # documents each rule
├── scripts/
│   └── setup.ts                      # generates oxfmt config + nano-staged in consuming project
├── tsconfig.json
└── README.md
```

## Phase 1: Create the Package

### 1.1 Scaffold

```bash
bun run add-package lint-config
```

### 1.2 Oxfmt Config (`oxfmt.json`)

Oxfmt doesn't support `extends`. The setup script copies this to the consuming project root as `.oxfmtrc.json`.

```json
{
  "trailingComma": "all",
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "printWidth": 100,
  "arrowParens": "always",
  "sortImports": {
    "groups": ["builtin", "external", ["internal", "subpath"], ["parent", "sibling", "index"]],
    "newlinesBetween": true,
    "ignoreCase": true
  },
  "sortPackageJson": true
}
```

The `internalPattern` is project-specific and injected by the setup script:

- `@beesolve/packages` → `["@beesolve/*"]`
- `expense-ease` → `["@app/*"]`
- Other projects → configured during setup

### 1.3 Oxlint Presets

#### `presets/base.oxlintrc.json` (shared by all)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "jsPlugins": ["@beesolve/lint-config/plugins/beesolve.js", "oxlint-plugin-eslint"],
  "rules": {
    // === Native rules ===
    // TypeScript
    "typescript/no-explicit-any": "warn",
    "typescript/consistent-type-imports": "error",
    "typescript/no-non-null-assertion": "warn",

    // Ban enums
    "eslint-js/no-restricted-syntax": [
      "error",
      {
        "selector": "TSEnumDeclaration",
        "message": "No enums. Use `as const` objects or union types instead.",
      },
      {
        "selector": "SwitchStatement",
        "message": "No switch statements. Use if-chains with early returns and assertUnreachable().",
      },
      {
        "selector": "TSArrayType",
        "message": "Use Array<T> instead of T[].",
      },
    ],

    // Performance
    "unicorn/no-accumulating-spread": "warn",

    // Custom beesolve rules
    "beesolve/prefer-props-object": "error",
    "beesolve/valibot-namespace-import": "error",
    "beesolve/no-valibot-date": "error",
    "beesolve/naming-conventions": "error",
  },
}
```

#### `presets/package.oxlintrc.json`

```jsonc
{
  "extends": ["@beesolve/lint-config/presets/base.oxlintrc.json"],
  "ignorePatterns": ["dist/", "node_modules/"],
}
```

#### `presets/monorepo.oxlintrc.json`

```jsonc
{
  "extends": ["@beesolve/lint-config/presets/base.oxlintrc.json"],
  "ignorePatterns": ["dist/", "node_modules/", ".svelte-kit/", "build/"],
}
```

#### `presets/sveltekit.oxlintrc.json`

```jsonc
{
  "extends": ["@beesolve/lint-config/presets/base.oxlintrc.json"],
  "ignorePatterns": [".svelte-kit/", "build/", "node_modules/"],
  "rules": {
    // Relax no-restricted-syntax for class usage in SvelteKit
    // (handled via overrides or inline disable comments)
  },
}
```

### 1.4 Custom Plugin (`plugins/beesolve.js`)

Single plugin with all custom rules:

#### Rule: `beesolve/prefer-props-object`

**Purpose**: Enforce single props/options object parameter pattern.

**Logic**:

- Flag functions/methods/arrow functions with >1 parameter
- Exception: exactly 2 params where both are object-typed (destructured `ObjectPattern`, or annotated with `TSTypeLiteral`/`TSTypeReference`)
- This allows the `(input, deps)` handler pattern

**Options**:

```jsonc
["error", { "maxParams": 1, "allowTwoObjectParams": true }]
```

#### Rule: `beesolve/valibot-namespace-import`

**Purpose**: Enforce `import * as v from "valibot"` — no named imports, no other alias.

**Logic**:

- Flag any `ImportDeclaration` with `source.value === "valibot"` that isn't `import * as v from "valibot"`
- Provides auto-fix

#### Rule: `beesolve/no-valibot-date`

**Purpose**: Ban `v.date()` in favor of `v.isoDateTime()`.

**Logic**:

- Flag `CallExpression` where callee is `v.date`
- Message: "Use v.isoDateTime() instead. Compare date strings with localeCompare()."
- Provides auto-fix (replace `v.date()` with `v.isoDateTime()`)

#### Rule: `beesolve/naming-conventions`

**Purpose**: Enforce camelCase everywhere, PascalCase for types/interfaces.

**Logic**:

- Visit `TSTypeAliasDeclaration`, `TSInterfaceDeclaration` → name must be PascalCase
- Visit `VariableDeclarator`, `FunctionDeclaration`, `Parameter` → name must be camelCase or UPPER_CASE (for constants)
- Ignore: destructured names, imports (can't control external APIs), names with underscores used as private markers
- Allow: leading underscore for unused params (`_value`)

#### Rule: `beesolve/file-naming` (future — document only for now)

**Purpose**: Enforce flat file structure with inverse naming (`entityAction.ts`).

**Planned logic**:

- Files must be camelCase: `^[a-z][a-zA-Z0-9]*(\.(test|spec))?\.ts$`
- Warn on directories nested more than 1 level deep within `src/`
- Suggest flattened naming pattern

**Status**: Not implemented in v1. Will be added after establishing naming patterns across projects.

### 1.5 Setup Script (`scripts/setup.ts`)

A Bun script that consuming projects run to bootstrap config:

```bash
bunx @beesolve/lint-config setup --type monorepo --internal "@app/*"
```

It will:

1. Write `.oxfmtrc.json` with the correct `internalPattern`
2. Write `.oxlintrc.json` extending the right preset
3. Write `.nano-staged.json`
4. Install and configure husky
5. Add scripts to `package.json`

### 1.6 `package.json`

```json
{
  "name": "@beesolve/lint-config",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./index.ts",
    "./oxfmt.json": "./oxfmt.json",
    "./presets/*": "./presets/*",
    "./plugins/*": "./plugins/*"
  },
  "dependencies": {
    "oxlint-plugin-eslint": "^1.0.0"
  },
  "peerDependencies": {
    "oxlint": ">=1.0.0",
    "oxfmt": ">=0.1.0"
  },
  "bin": {
    "beesolve-lint-setup": "./scripts/setup.ts"
  }
}
```

## Phase 2: Migrate `@beesolve/packages` Monorepo

### 2.1 Remove Biome

```bash
bun remove @biomejs/biome
rm biome.json
```

### 2.2 Add Dependencies

```bash
bun add -D oxlint oxfmt nano-staged husky
```

### 2.3 Add Config Files

`.oxlintrc.json` (root):

```jsonc
{
  "extends": ["./packages/lint-config/presets/package.oxlintrc.json"],
}
```

`.oxfmtrc.json` (root):

```json
{
  "trailingComma": "all",
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "printWidth": 100,
  "arrowParens": "always",
  "sortImports": {
    "groups": ["builtin", "external", ["internal", "subpath"], ["parent", "sibling", "index"]],
    "internalPattern": ["@beesolve/*"],
    "newlinesBetween": true
  },
  "sortPackageJson": true
}
```

### 2.4 Add nano-staged

`.nano-staged.json`:

```json
{
  "*": "oxfmt --no-error-on-unmatched-pattern",
  "**/*.{js,ts,jsx,tsx}": "oxlint"
}
```

### 2.5 Add Husky

```bash
bun husky init
echo "./node_modules/.bin/nano-staged" > .husky/pre-commit
```

### 2.6 Update `package.json` Scripts

```json
{
  "scripts": {
    "lint": "oxlint packages/ scripts/",
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check",
    "check": "oxfmt --check && oxlint packages/ scripts/",
    "build": "bunup",
    "dev": "bunup --watch",
    "test": "bun run --filter '*' test",
    "type-check": "bun run --filter '*' type-check",
    "version": "changeset version",
    "publish:packages": "bun run build && bun scripts/publish.ts",
    "add-package": "bun scripts/add-package.ts",
    "recalculate-dependencies": "bun scripts/recalculate-dependencies.ts",
    "prepare": "husky"
  }
}
```

### 2.7 Format and Fix

```bash
bun run fmt          # reformat all files (single commit: "chore: adopt oxfmt")
bun run lint --fix   # auto-fix what's possible
bun run lint         # verify clean
```

### 2.8 Verify

```bash
bun run check        # must pass clean
bun run type-check   # ensure no regressions
bun run test         # ensure tests still pass
```

## Phase 3: Documentation

### In `packages/lint-config/README.md`

Document:

- How to consume in each project type
- List of all rules and their rationale
- How to write new custom rules
- Convention: prefer `localeCompare` for ISO date string comparison (documented, not enforced by lint)
- Convention: file naming pattern `entityAction.ts` (documented, enforcement planned)

### Update `.kiro/steering/typescript.md`

Change:

```diff
- Formatter/linter: Biome with 2-space indent, double quotes
+ Formatter: Oxfmt (via @beesolve/lint-config)
+ Linter: Oxlint (via @beesolve/lint-config)
+ Pre-commit: nano-staged + husky
```

## Conventions (Documented, Not Lint-Enforced)

These conventions are documented in the README but not enforced by automated tooling:

1. **Date string comparison**: Use `localeCompare()` for comparing ISO date strings, not `>` / `<` operators.

2. **Valibot schema-first types**: Define valibot schemas at boundaries and infer types with `v.InferOutput<typeof schema>` / `v.InferInput<typeof schema>`. Don't manually write types that duplicate schema shapes.

3. **File naming (future rule)**: Prefer flat directories with inverse naming:
   - `userOne.ts`, `userMany.ts`, `user.ts` instead of `user/one.ts`, `user/many.ts`
   - camelCase filenames only
   - Test files: `entityAction.test.ts`

4. **Classes**: Avoid unless required by framework (SvelteKit) or boundary pattern (repository classes for database access). Suppress lint warning inline when justified.

## Execution Order

- [x] Create `packages/lint-config` package scaffold
- [x] Write `oxfmt.json`
- [x] Write `presets/base.oxlintrc.json`
- [x] Write project-type presets (package, monorepo, sveltekit)
- [x] Write `plugins/beesolve.js` with all custom rules
- [x] Write `scripts/setup.ts`
- [x] Write package README
- [x] Remove Biome from root
- [x] Install oxlint, oxfmt, nano-staged, husky
- [x] Add root config files (`.oxlintrc.json`, `.oxfmtrc.json`, `.nano-staged.json`)
- [x] Configure husky pre-commit
- [x] Update root `package.json` scripts
- [ ] Run `oxfmt` — commit as "chore: adopt oxfmt"
- [ ] Run `oxlint --fix` — commit fixes
- [x] Verify all passes clean (tools run, 132ms lint / 302ms format)
- [x] Update steering docs
- [ ] Publish lint-config (or use `workspace:^` internally first)
