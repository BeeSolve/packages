# ADR-001: Motivation

## Status

Accepted

## Context

Local development commonly loads its environment from committed `.env.*` files. Two problems recur:

1. Secrets end up committed in plaintext: API keys, HMAC secrets, and third-party config get pushed to git.
2. Resource names and ARNs are hand-copied: DynamoDB table names, S3 buckets, SQS queue URLs, and Lambda ARNs carry random CloudFormation suffixes, must be pasted in manually, and drift the moment a stack is recreated.

Both are mechanically avoidable. Everything in such a file is derivable from AWS plus a small amount of static config: non-secret resource identifiers come from one CloudFormation `ListStackResources` call, secrets come from one Secrets Manager `GetSecretValue` call, and static values (region, fixed URLs, constant index names) come from the consuming project.

This logic is project-agnostic. Every project that needs it would otherwise re-implement the same resolve, cache, and inject cycle.

## Decision

Ship `@beesolve/aws-env-resolver` as a reusable CLI and library that:

- resolves the environment from static config, CloudFormation resources (matched by logical-id prefix), and one Secrets Manager secret
- caches non-secret values in the OS temp dir and secrets in the macOS login keychain
- injects the result into a spawned child command (`aws-env-resolver --stage <stage> -- <command>`) instead of writing a file
- reads all project-specific knowledge (stack, mappings, static values) from a committed `aws-env.config.ts` or `aws-env.config.json`

The package boundary is: resolve, cache, inject. It does not write secrets to AWS, rotate them, manage infrastructure, or interpret environment names.

## Rationale

### 1. A CLI wrapper instead of a generated dotfile

Writing a `.env.*.local` file puts secrets in the project tree at a predictable path, where they can be committed by accident, picked up by tooling, or read by any process. A wrapper hands values to the child only through its inherited process environment, so nothing secret lands in the project tree. The wrapped command stays unchanged and its import-time env validation works as before.

### 2. Keychain instead of plaintext, with an honest limit

On macOS, secrets are cached in the login keychain through the `security` CLI, encrypted at rest under the login password, and read through OS-mediated access. There is no plaintext file and no predictable dotfile path. The limit is stated rather than hidden: malware already running as the user can call `security` the same way the resolver does, unless the item forces a prompt. That is why the default is interactive.

### 3. Interactive by default, with an independent `--trusted` opt-in

By default items are stored with an empty trust list (`-T ""`), so macOS prompts before the `security` binary may read an item and the resolver never handles the user's password. `--trusted` stores items with `-T /usr/bin/security`, which makes reads silent. It is a plain on/off flag. The package does not couple it to any environment or "production" notion and never refuses it; the user decides the tradeoff.

### 4. An optional stage label

Projects differ in how they select which environment to resolve. The package accepts an optional `stage` string (originally an opaque, required `namespace`). It selects the per-stage config file `aws-env.config.<stage>.*`, is passed to a config factory so the project can choose a stack, secret, or profile, and keys the cache and keychain so parallel environments do not collide. The package never branches on its value beyond using it in those names, so it is restricted to letters, digits, `.`, `_` and `-`.

It was renamed because, once it picks the config file, it is a stage in every real use, and "namespace" left users guessing what to pass. It became optional so single-stage projects need no flag; caches then use the label `default`. The original fail-fast intent is kept by the file lookup instead of a required flag: a multi-stage project that keeps only `aws-env.config.<stage>.json` files fails with "no config file found" when `--stage` is forgotten. A project that also keeps a generic `aws-env.config.*` (or a factory that does not validate its argument) gives that up, and the factory receives `undefined`.

### 5. One identity for cache and keychain

Both the temp-dir cache file and the keychain service derive from `{ projectKey, stage, fingerprint }`, where the fingerprint is a short hash of `{ region, stackName, secretId }`. The working directory is never part of it. Two checkouts of the same repo pointed at the same stack share entries (correct, the values are identical). Two pointed at different stacks get separate entries and never overwrite each other. The fingerprint must be in the keychain service as well as the cache key, otherwise the second checkout would overwrite the first checkout's secret under a service name that no longer matched its stack.

### 6. Injected project config for reuse

The package knows how to resolve, not what a project needs. The mapping lives in a committed config file that contains names and mappings only, never secret values. This keeps the package free of project knowledge and the config safe to commit.

## Consequences

- The secure secret cache is macOS-only. On any other platform a no-op store is used: secrets are fetched from Secrets Manager on every run and live only in the child's environment, never on disk.
- Steady state makes zero AWS calls: one temp-file read and one keychain read per secret. AWS is called on first run, TTL expiry (24h by default), a cache miss, or `--refresh`.
- In the default interactive mode macOS may prompt once per secret on read.
- Running the CLI requires Bun. The runtime choice is covered in [ADR-003](./adr-003-bun-runtime-dependency.md) and is not repeated here.
- AWS access is read-only: `cloudformation:ListStackResources`, `secretsmanager:GetSecretValue`, and `sts:GetCallerIdentity` only when an ARN transform runs without a configured account id.
- Only one secret id per config is supported.

## Alternatives Considered

### `.env.*.local` files

Familiar and zero tooling, but secrets sit in plaintext at a predictable path and resource names are still hand-copied and drift. This is the situation the package exists to remove.

### SSM Parameter Store

Parameters could hold both secrets and resource names, but that moves the hand-copy problem into AWS: every resource name must be published as a parameter, and stack outputs would need to be mirrored there. CloudFormation already knows the physical ids, so reading them directly removes a synchronization step.

### 1Password CLI

Good secret storage and access control, but it adds a vendor and an account requirement, and does nothing for CloudFormation-derived resource names. The secrets already live in Secrets Manager for deployed code, so a second secret source would duplicate them.

### AWS Vault

Solves credential handling (short-lived credentials in the OS keychain), not environment resolution. It is complementary: a profile backed by AWS Vault works as the `profile` the resolver uses.
