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

If the account enforces 2FA for writes, publish with an OTP (ask the user for the code). The
npm CLI expects the equals form `--otp=<code>` — a space-separated `--otp <code>` is parsed as
an unknown positional and fails:

```bash
npm publish --access public --otp=<code>
```

OTP codes are single-use and short-lived (~30s). Each `npm publish` and each `npm trust`
consumes one, so ask the user for a fresh code at each write step rather than reusing one.

### 6. Register the GitHub Actions Trusted Publisher

New package names can take several minutes to become visible after publish (npm prints
"being processed and may take a few minutes"). Poll until `0.0.0` resolves before registering
trust — allow up to ~5 minutes:

```bash
for attempt in $(seq 1 40); do
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

**CLI (preferred):**

```bash
npm trust github <package-name> --file publish.yml --repo BeeSolve/packages --allow-publish --yes --otp=<code>
```

Notes on the current npm CLI (verified on npm 11.19.0):

- `--allow-publish` is **required** — without a permission flag the command fails with
  "At least one permission flag is required". This grants the CI `publish.yml` workflow publish
  access. (`--allow-stage-publish` is a separate grant; npm reports the result as
  `publish, stage publish`.)
- The workflow file `publish.yml` runs on push to `main` with no GitHub environment, so no
  `--env`/`--environment` flag is needed. Add `--env <name>` only if the workflow pins a GitHub
  environment.
- 2FA is required and uses the equals form `--otp=<code>` (a space-separated `--otp <code>` is
  rejected as an unknown positional). Run a `--dry-run` first (it needs no OTP) to confirm the
  config, then supply a fresh OTP for the real call.

A successful registration prints `Trust configuration created successfully` plus a trust `id` —
that message is the authoritative confirmation.

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

Do **not** rely on `npm trust list <package-name>` to verify — on current npm it is itself
2FA-gated and will fail with `EOTP` unless you spend another OTP. The
`Trust configuration created successfully` message (with its trust `id`) printed by step 6 is
the authoritative confirmation; capture that id.

Report:

- package name
- published version (`0.0.0`)
- confirmation that the Trusted Publisher was registered for `.github/workflows/publish.yml`
  (the trust `id` from step 6), via `npm trust github` or the web UI

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
