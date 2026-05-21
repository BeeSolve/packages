# Publishing a Package for the First Time

OIDC Trusted Publisher authentication (used by the automated `publish.yml` workflow) can only be configured after the package already exists on npm. So the very first publish of any package must be done manually.

## Prerequisites

Make sure you are logged in to npm:

```bash
npm whoami
```

If not, run `npm login` and follow the prompts.

## Steps

### 1. Build

From the repo root, run the full build so `dist/` is up to date:

```bash
bun run build
```

### 2. Run `prepublishOnly` (if the package has it)

`bun pm pack` does not trigger lifecycle scripts, so check whether the package has a `prepublishOnly` script in its `package.json`. Packages that bundle Lambda zip files (`service-auth`, `service-email`) do:

```bash
cd packages/<name>
bun run prepublishOnly
```

Skip this step for packages that have no `prepublishOnly` script (`helpers`, `cdk-constructs`, etc.).

### 3. Pack

From inside the package directory, pack using `bun pm pack` — this resolves `workspace:^` and `catalog:` references in `package.json` before creating the tarball:

```bash
bun pm pack
```

This creates a `beesolve-<name>-X.X.X.tgz` file in the current directory.

### 4. Publish

```bash
npm publish *.tgz --access public
```

Because your npm account has 2FA enabled, npm will print a URL:

```
npm error Open this URL in your browser to authenticate:
npm error   https://www.npmjs.com/auth/cli/<token>
```

Open that URL in your browser, approve the publish, and the CLI will complete automatically.

### 5. Clean up

```bash
rm *.tgz
```

## After the first publish: set up OIDC Trusted Publisher

Once the package exists on npm, register GitHub Actions as a Trusted Publisher so subsequent publishes happen automatically via `publish.yml` without any token or OTP:

1. Go to `https://www.npmjs.com/package/@beesolve/<name>/access`
2. Click **Add Trusted Publisher → GitHub Actions**
3. Fill in:
   - **Organization:** `BeeSolve`
   - **Repository:** `packages`
   - **Workflow file:** `publish.yml`

After this, merging a Changesets "Version Packages" PR to `main` will publish the package automatically.
