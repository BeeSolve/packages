---
name: publish-placeholder-package
inclusion: manual
description: Publish a placeholder npm package at version 0.0.0 to reserve the @beesolve/<name> package name and configure npm OIDC Trusted Publisher before CI publishing. Use once when creating a brand-new package that is not ready for a real release. Internal to the @beesolve/packages monorepo.
---

## Overview

Use this skill to publish a minimal placeholder package to npm at `0.0.0`. This reserves the
`@beesolve/<name>` package name and unblocks npm-side OIDC configuration so the CI
`publish.yml` workflow can publish real releases via Trusted Publishers (no `NPM_TOKEN`).

This is a **one-time bootstrap** step. Normal releases go through changesets in CI. OIDC trust
can only be registered after the package exists on npm, which is why the placeholder is
published first — instead of doing a first manual _real_ publish.

The step is only complete once the Trusted Publisher is registered — do not stop after
`npm publish`.

## Inputs

- **npm package name** — `@beesolve/<name>` (e.g. `@beesolve/lambda-function-url-protection`)
- **repo package directory** — `packages/<name>` (may differ from the scope suffix for some
  packages; confirm against the directory on disk)

## Workflow

### 1. Confirm the publish target

Collect the npm package name and the repo package directory. Read the package's own
`package.json` `name` field to confirm the exact scope — do not assume it matches the directory.

### 2. Check the name is not already published at 0.0.0

```bash
npm view <package-name>@0.0.0 version
```

If this resolves to `0.0.0`, stop and report that no placeholder publish is needed (the name is
already reserved — proceed straight to verifying the Trusted Publisher in step 6).

### 3. Build a minimal placeholder outside the repo

Always publish from a temp directory so none of the real package files are shipped by mistake.

```bash
tmp_dir="$(mktemp -d)"
cd "$tmp_dir"

cat > package.json <<'JSON'
{
  "name": "<package-name>",
  "version": "0.0.0",
  "description": "Placeholder package to reserve the npm name and configure OIDC Trusted Publisher.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/BeeSolve/packages.git",
    "directory": "<repo-package-dir>"
  },
  "publishConfig": {
    "access": "public"
  }
}
JSON

cat > README.md <<'MD'
# Placeholder Package

Published at `0.0.0` to reserve the npm name and configure CI publish (OIDC Trusted Publisher)
permissions. The real package is released from the @beesolve/packages monorepo via changesets.
MD
```

### 4. Ensure npm auth is valid

```bash
npm whoami
```

If not authenticated, run `npm login`. Expect npm to require a fresh login and/or a one-time
password. If prompted for an OTP, ask the user for the current code and continue.

### 5. Publish the placeholder

```bash
npm publish --access public
```

If the account enforces 2FA for writes, publish with an OTP (ask the user for the code):

```bash
npm publish --access public --otp <code>
```

### 6. Register the GitHub Actions Trusted Publisher

New package names can take a short time to become visible after publish. Poll until `0.0.0`
resolves before registering trust:

```bash
for attempt in $(seq 1 18); do
  version=$(npm view <package-name>@0.0.0 version --silent 2>/dev/null || true)
  if [ "$version" = "0.0.0" ]; then
    break
  fi
  echo "Waiting for <package-name>@0.0.0 to appear on npm..."
  sleep 10
done

if [ "$version" != "0.0.0" ]; then
  echo "Package did not appear on npm in time"
  exit 1
fi
```

As soon as it resolves, register the Trusted Publisher from the same machine where you
published (while local npm auth is still valid).

**Preferred — CLI:**

```bash
npm trust github <package-name> --repo BeeSolve/packages --file publish.yml --yes
```

**Fallback — npmjs.org web UI** (use if the `npm trust` subcommand is unavailable in the
installed npm version):

1. Go to `https://www.npmjs.com/package/<package-name>/access`
2. Click **Add Trusted Publisher → GitHub Actions**
3. Enter:
   - Organization: `BeeSolve`
   - Repository: `packages`
   - Workflow file: `publish.yml`

### 7. Verify and report

```bash
npm view <package-name>@0.0.0 version
```

Report:

- package name
- published version (`0.0.0`)
- confirmation that the Trusted Publisher was registered for `.github/workflows/publish.yml`
  (via `npm trust github` or the web UI)

### 8. Clean up

```bash
rm -rf "$tmp_dir"
```

## Notes

- Keep the placeholder minimal — never publish real source code in this step.
- The CI workflow (`.github/workflows/publish.yml`) authenticates via OIDC Trusted Publishers
  and must have **no** `NPM_TOKEN` / `NODE_AUTH_TOKEN` set — their presence breaks OIDC auth.
- After the placeholder exists and trust is registered, the first real release happens through
  the normal changesets flow: add a changeset, merge, let the Changesets bot open the Version
  PR, and merging that PR triggers `publish.yml`.
