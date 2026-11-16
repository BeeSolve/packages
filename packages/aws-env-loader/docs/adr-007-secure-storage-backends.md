# ADR-007: Secure Storage Backends Are Shipped, Not User-Supplied

## Status

Accepted

## Context

Secrets are cached in the macOS login keychain through the `security` CLI (ADR-001). On every other platform the secret store is a no-op and secrets are fetched from Secrets Manager on every run.

Users on Linux or Windows asked to decouple the package from the keychain, with two ideas:

1. A `secureStorage` option on `devEnv`, typed against a public interface, defaulting to the keychain implementation.
2. A `cachePath` option on `devEnv`, defaulting to `os.tmpdir()`.

The `SecretStore` interface already exists internally (`get`, `set`, `purge`), but nothing is exported and `resolveEnv` hardcodes `createSecretStore`.

The difficulty is that `devEnv` runs at CDK synth time and writes a JSON config. The store is used later, when the CLI or `resolveEnv` loads that JSON. An object cannot be serialized into JSON, so letting users supply their own store through the config means the config must reference code: a module path or a helper command that the loader executes.

## Decision

Secure storage backends are implemented, reviewed and shipped by this package, per platform. The package does not load user-supplied code (a module path or a helper command) from a committed config file.

For now the keychain stays the only secure backend. Other platforms keep the current behaviour (no secure cache, secrets fetched on every run). Users on another platform are asked to open an issue so the backend for their platform can be designed and reviewed here.

When backends are added, the committed config selects one by built-in name only (for example `secureStorage: "keychain"`), never by path or command. The default stays the keychain on macOS and no secure cache elsewhere, so existing users change nothing.

Nothing is implemented in this step. This ADR records the direction and the reasoning.

## Rationale

### 1. A config that names code to run changes the trust model

Today the emitted `aws-env.config.<stage>.json` is inert data. If it can name a module or a command, anyone who can change that file gets code execution the next time someone runs `aws-env-loader`, with the user's privileges, while AWS credentials are loaded. The store also receives every secret in plaintext by definition, so a malicious store can exfiltrate all of them. Realistic routes to changing the file are a malicious pull request, a cloned untrusted repository, or a compromised dependency that rewrites a generated file. The change is one line in a generated, committed JSON file and is easy to miss in review.

A bare package name adds typosquatting and dependency-confusion risk on top, because it resolves through `node_modules`.

Hand-written `.ts` configs already execute code. They are written and reviewed by the project, and the author chose that format. A generated `.json` file does not carry the same expectation.

### 2. Shipped backends keep the review surface in one place

Each backend handles plaintext secrets and spawns a platform tool. Implementing them here means they are reviewed once, tested once, and use the same identity (`projectKey`, `stage`, fingerprint) as the cache file. A user-written store would need to rebuild all of that and could get it wrong.

### 3. Selecting by built-in name is serializable and safe

A name such as `"keychain"` fits in the emitted JSON, is validated by a `picklist` schema, and selects code that already ships in the package. There is nothing to execute from the config.

### 4. Platform tools already exist and are cheap to wrap

The keychain backend wraps `/usr/bin/security`. Equivalent backends for other platforms wrap an established tool in the same way, so each one is a small, reviewable addition rather than a new subsystem.

## Consequences

- Linux and Windows users keep fetching secrets on every run until a backend for their platform ships.
- Adding a platform requires a release of this package. This is intentional: it is the review gate.
- The README states the macOS-only limit and asks users on other platforms to open an issue.
- `SecretStore`, `KeychainSecretStore` and `NoopSecretStore` stay internal for now. Exporting them is a separate decision, and would only be made together with a programmatic option on `resolveEnv`.
- `cachePath` is not part of this decision. It is a serializable string with a much smaller risk (a non-secret JSON file is written to it), so it can be added later as a `devEnv` and `resolveEnv` option. It should be resolved to an absolute path and validated when it is added.

## Alternatives Considered

### Module path in the config

`secureStorage: "./secret-store.ts"`, imported dynamically by the loader. Familiar from Jest, ESLint, Babel and Prettier plugins. Rejected because it makes the committed JSON executable (see Rationale 1).

### External helper command

A command in the config that the loader runs with `get`, `store` and `erase` and a JSON exchange on stdin and stdout, as git credential helpers, Docker credential helpers and the AWS CLI `credential_process` do. Language-agnostic and well understood. Rejected for the same reason as the module path: the config chooses what gets executed.

### Custom store only through a CLI flag, environment variable or programmatic option

`--secret-store <module>`, or a `secretStore` option on `resolveEnv`, so the person running the tool chooses the code and not the repository. This avoids the config risk. Not done now because it commits the package to a public store interface and protocol before any second backend exists. It stays an option if shipped backends turn out not to be enough.

### Cross-platform keyring library

A dependency such as `@napi-rs/keyring` for macOS, Windows and Linux. Rejected because it adds a native dependency and replaces the `security` CLI choice made in ADR-001. It is also not extensible.

### Code-only config

Allow the store as a field in a hand-written `.ts` config. This only helps users who write the config by hand instead of using `devEnv`, and it does not address the generated JSON path.

## Future Possible Work

Backends that are straightforward to add, in no priority order. None is implemented.

- **Linux: `secret-tool`** (libsecret, GNOME Keyring or KWallet). A generic-password-style store and lookup by attributes, equivalent to the keychain item.
- **Windows: Credential Manager.** Through `cmdkey` or a PowerShell credential API call.
- **`pass`** (the standard Unix password manager). Works wherever GPG is set up.
- **1Password CLI (`op`).** For teams that already keep secrets there.
- **`cachePath`.** A configurable directory for the non-secret cache, as described under Consequences.

Each of these needs its own security review, a test seam like the existing `SecurityRunner`, and a decision on what `trusted` means for that backend.
