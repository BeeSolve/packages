# ADR-001: SvelteKit App-Owned User Directory for the Impersonation Sample

## Status

Accepted

## Context

The impersonation sample demonstrates operator-less session impersonation: an admin
signs in, picks another account from a list, and acts as that user with a full audit
trail. To render "pick a user to impersonate", the sample needs to enumerate the
accounts that exist.

`@beesolve/auth-service` authenticates identities and mints sessions, but it
deliberately exposes no "list all accounts" SDK command. Identity enumeration is an
application concern — which identities exist, how they are grouped, and who may be
impersonated are decisions the consuming application owns, not the auth service.

The sample was previously a static SPA (a single `index.html` served via
`StaticWebsite`) with a separate authorized API Lambda behind `/api/*`. That shape
had no directory of its own and no natural way to list impersonatable users.

## Decision

The sample owns its own user directory as a DynamoDB table, and the frontend is a
SvelteKit app served via `kit-on-lambda` instead of a static SPA.

- A DynamoDB table (single-table design: pk `user#<email>`, sk `user`) with a reverse
  global secondary index keyed on `sk` provides an efficient "list all users" query.
- The table name and reverse index name are injected into the SSR handler as the
  `SAMPLE_USERS_TABLE_NAME` and `SAMPLE_USERS_REVERSE_INDEX` environment variables.
- The SvelteKit handler reads the directory to render the impersonation picker, calls
  the `impersonate` SDK command (via `grantSdkAccess`) to flip the caller's own session
  into impersonating mode, and relies on `POST /auth/endImpersonation` to revert it.
- An EventBridge consumer continues to audit `ImpersonationStarted` /
  `ImpersonationEnded`.

## Rationale

### 1. Enumerating identities is an application concern

The auth service intentionally has no list-all-accounts command. The set of
impersonatable users, and the rules for who may impersonate whom, belong to the
application. Owning a directory table keeps that responsibility where it belongs and
avoids pushing an enumeration capability into a shared, published auth package.

### 2. Mirrors the real dmarc-dashboard pattern

The production `dmarc-dashboard` owns its user directory the same way: a `Users` model
over a single table with pk `user#<email>` / sk `user` and a reverse GSI on `sk` for
listing (`packages/dmarc-dashboard/src/lib/server/users.ts`). Following that shape makes
the sample an accurate reference for how real projects consume the auth service.

### 3. SvelteKit over a static SPA

Moving to SvelteKit + kit-on-lambda lets the sample reuse the shared sign-in components
and matches how real beesolve projects consume the auth service (SSR handler behind the
session authorizer, `/auth/*` behavior, ensure-cookie function). A static SPA plus a
bespoke `/api` Lambda diverged from that reality and duplicated auth wiring.

## Consequences

- The sample provisions and owns a DynamoDB table. `removalPolicy` is `DESTROY` and
  billing is `PAY_PER_REQUEST` because it is a disposable sample, not production.
- The sample now more faithfully mirrors production usage, at the cost of a heavier
  build (a SvelteKit `vite build` step is added to the deploy script).
- The directory is the sample's own data; it does not read or depend on any internal
  auth-service storage.

## Alternatives Considered

### Option A: Add a `listAccounts` scan command to auth-service

Rejected. Shipping a table `Scan` in a published, shared auth package invites
production misuse — an unbounded scan is easy to call, expensive at scale, and
encourages consumers to treat the auth store as a general-purpose user directory.
Identity enumeration is an application responsibility, so the capability belongs in the
application's own directory, not in the auth service's SDK surface.

### Option B: Keep the static SPA with a bespoke `/api` Lambda

Rejected. It duplicated auth wiring, could not reuse the shared sign-in components, and
diverged from how real projects (e.g. dmarc-dashboard) consume the auth service, making
it a poor reference sample.
