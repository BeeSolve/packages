# npm Publishing Automation — Task Checklist

## Step 1 — Initialize Changesets

- [x] Run `bunx changeset init` to generate `.changeset/config.json`
- [x] Edit `.changeset/config.json` to set `access: "public"`, `baseBranch: "main"`, `updateInternalDependencies: "patch"`

## Step 2 — Update Root `package.json`

- [x] Add `@changesets/cli: "^2.27.0"` to `devDependencies`
- [x] Add `version` script: `changeset version`
- [x] Add `publish:packages` script: `bun run build && bun scripts/publish.ts`
- [x] Run `bun install` to install `@changesets/cli`

## Step 3 — Create `scripts/publish.ts`

- [x] Create `scripts/publish.ts` with topological publish logic
- [x] Verify `bun pm pack` resolves `workspace:^` references (inspect tarball on a package with internal deps):
  ```bash
  bun pm pack
  tar -xOf *.tgz package/package.json | grep -E 'workspace|catalog'
  rm *.tgz
  ```
  - Confirmed: grep returns nothing — references fully resolved. Hybrid approach is safe.

## Step 4 — Create `.github/workflows/ci.yml`

- [x] Create `.github/workflows/ci.yml` (checkout → setup-bun → install → build → type-check)

## Step 5 — Create `.github/workflows/publish.yml`

- [ ] Create `.github/workflows/publish.yml` (changesets/action with version + publish steps)
- [ ] Confirm `actions/setup-node@v6` with `node-version: '24'` and `registry-url` set (no `NODE_AUTH_TOKEN`)
- [ ] Confirm `id-token: write` permission is present

## Step 6 — Register OIDC Trusted Publishers on npmjs.org (manual, one-time)

- [ ] `@beesolve/helpers` — add Trusted Publisher (org: `beesolve`, repo: `packages`, workflow: `publish.yml`)
- [ ] `@beesolve/cdk-email-alarms` — add Trusted Publisher
- [ ] `@beesolve/cdk-constructs` — add Trusted Publisher
- [ ] `@beesolve/lambda-fetch-api` — add Trusted Publisher
- [ ] `@beesolve/email-service` — add Trusted Publisher
- [ ] `@beesolve/sqs-handler` — add Trusted Publisher

## Step 7 — Create `docs/adding-a-package.md`

- [ ] Write guide covering: directory structure, required `package.json` fields, `bunup.config.ts` entry, `scripts/publish.ts` entry, OIDC registration, first manual publish steps, developer changeset workflow

## Verification

- [ ] Open a test PR, run `bunx changeset`, commit the `.changeset/*.md` file, merge to main
- [ ] Confirm Changesets bot opens a "Version Packages" PR with bumped versions and CHANGELOG entries
- [ ] Merge the Version PR and watch `publish.yml` — confirm packages publish in topological order
- [ ] Check npmjs.org for provenance attestation on the new package versions
- [ ] Confirm no `NPM_TOKEN` secret is stored in GitHub repo settings
