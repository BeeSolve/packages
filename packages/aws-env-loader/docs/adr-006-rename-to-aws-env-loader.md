# ADR-006: Rename to aws-env-loader

## Status

Accepted

## Context

The package was published as `@beesolve/aws-env-resolver` with an `aws-env-resolver` CLI. "Resolver" names only one step of what the package does. The tool resolves values from CloudFormation and Secrets Manager, caches them, injects them into the environment, and runs a command with it. Users reach for it the way they reach for `dotenv` or `bun --env-file`: to load an environment before running something.

The package is `0.x`, so a breaking rename is allowed without a major version.

## Decision

Rename the npm package to `@beesolve/aws-env-loader`, the CLI binary to `aws-env-loader`, and the directory to `packages/aws-env-loader`. The on-disk cache directory and the keychain service prefix follow the new name (`aws-env-loader/` in the OS temp dir, `aws-env-loader:<projectKey>:<stage>:<fingerprint>` in the keychain).

The library API keeps its names (`resolveEnv`, `ResolverConfig`, `purgeCache`). Resolving is still what those functions do, and keeping them limits the migration to an import path and a script name.

`@beesolve/aws-env-resolver` gets a final release with the pending fixes and is then deprecated on npm with a pointer to the new name.

## Rationale

### 1. The name describes the job

"Loader" matches the user's intent (load env, then run) and the familiar `dotenv` mental model. "Resolver" describes an implementation step and suggests a library that only looks values up.

### 2. A clean break is cheap now

Few projects depend on the package, and every one of them changes one dependency line and one script. The cost grows with every adopter, so `0.x` is the right time.

### 3. One name everywhere

Keeping the old cache and keychain prefixes would leave two names in circulation, visible in Keychain Access and the temp dir. Following the new name costs one refetch per stage.

## Consequences

- Consumers replace the dependency and the `aws-env-resolver` command in their scripts.
- Existing cache files and keychain items are not read. Each stage refetches once, and items stored with `--trusted` need one more `--trusted` run. Old items can be removed from Keychain Access (service `aws-env-resolver:...`).
- The new npm name needs its own Trusted Publisher registration before CI can publish it.
- `CHANGELOG.md` history keeps the old name in past entries.

## Alternatives Considered

### Keep `aws-env-resolver`

No migration cost, but the name keeps underselling the tool.

### Rename the package but keep an `aws-env-resolver` bin alias

Eases migration, but keeps two command names alive indefinitely for a `0.x` package with few users.

### Rename the library API as well

`ResolverConfig` to `LoaderConfig` and similar. Rejected: the functions still resolve, and renaming them widens the migration for no behavior change.
