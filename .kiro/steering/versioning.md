# Versioning Convention — @beesolve/packages

## Pre-1.0 Packages Are Unstable

Any package at version `0.x.y` is considered **under active development**. Breaking
changes are expected and may land in any `0.x` release without a major version bump.

- `0.x.y` → breaking changes are allowed in a `minor` (or even `patch`) changeset.
  Do not treat a breaking change in a `0.x` package as requiring a major bump.
- `>= 1.0.0` → the package follows **semantic versioning**. Every breaking change
  requires a new **major** version.

When deciding the changeset bump type for a package, first read its current
`version` from `package.json`:

- If `0.x.y`: a breaking change is a `minor` bump; a non-breaking change is a `patch`.
- If `>= 1.0.0`: a breaking change is a `major` bump.

## Stability Banner in README

Every published package at `0.x.y` must carry a stability banner at the top of its
`README.md`, directly under the H1 title and one-line description, before the first
`##` section:

```markdown
> [!WARNING]
> **Pre-1.0 — unstable API.** This package is `0.x` and under active
> development. Breaking changes can land in any `0.x` release without a major
> version bump. Pin an exact version and review the changelog before upgrading.
> Once the API stabilizes and the package reaches `1.0.0`, it follows semantic
> versioning and this notice is removed.
```

Rules:

- The banner is **required** for every public package while it is `0.x.y`.
- When a package is promoted to `1.0.0`, **remove the banner** in the same changeset
  that cuts the `1.0.0` release.
- Private packages (e.g. `packages/samples`, `"private": true`) are never published
  and do not need the banner.
