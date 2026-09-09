# Plan: Add React Preset

## Goal

Add a `presets/react.oxlintrc.json` preset that relaxes rules incompatible with React + MUI + TanStack Router patterns.

## Rationale

React/MUI projects consistently need these rules disabled in frontend files:

- `no-floating-promises` — `validate(form)`, `void navigate(...)` are fire-and-forget by design in UI
- `no-misused-promises` — React/MUI `onClick`, `onChange` expect `void` return; async handlers are standard
- `only-throw-error` — TanStack Router's `throw redirect()` is idiomatic framework usage
- `no-misused-spread` — MUI `SxProps` is a union including functions; spreading is fine in practice

Currently each project duplicates this config locally. Centralizing it in a preset keeps it consistent.

## Implementation

Create `presets/react.oxlintrc.json`:

```json
{
  "extends": ["./monorepo.oxlintrc.json"],
  "overrides": [
    {
      "files": ["**/*.tsx", "**/web/**/*.ts"],
      "rules": {
        "typescript/no-floating-promises": "off",
        "typescript/no-misused-promises": "off",
        "typescript/only-throw-error": "off",
        "typescript/no-misused-spread": "off"
      }
    }
  ]
}
```

## Usage

In consuming projects:

```json
{
  "extends": ["./node_modules/@beesolve/lint-config/presets/react.oxlintrc.json"]
}
```

## File pattern notes

- `**/*.tsx` covers all React component files
- `**/web/**/*.ts` covers frontend utility files (e.g., auth helpers that use `throw redirect()`)
- Backend `.ts` files keep strict promise handling — these rules catch real bugs in Lambda handlers

## After publishing

Update `bewatr-reporting/.oxlintrc.json` to use the preset and remove the local overrides.
