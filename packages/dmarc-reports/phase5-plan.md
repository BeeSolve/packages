# Phase 5: Self-Service User Management & Setup Flow

## Overview

Replace the CLI-based user creation with an in-app setup flow and admin-driven user management. The first user becomes an admin via a one-time `/setup` route. Admins can invite users and manage domain whitelists through the dashboard UI.

## Goals

- **Zero-CLI onboarding**: No `create-user` script needed. Deploy the stack, visit `/setup`, done.
- **Admin role**: Full access to all domains, can invite/manage users
- **User role**: Access restricted to whitelisted domains only
- **Self-contained**: No CDK props needed for initial admin email — the setup route handles it

## Design

### User Types

| Type    | Domains Access | Can Invite | Can Manage Users |
| ------- | -------------- | ---------- | ---------------- |
| `admin` | All domains    | Yes        | Yes              |
| `user`  | Whitelisted    | No         | No               |

### Updated User Schema

```
pk: "user#<email>"
sk: "user"
email: string
type: "admin" | "user"
domains: string[]          // ignored for admin (sees all), used for user
createdAt: string          // ISO timestamp
```

### Setup Gate

A new entity tracks whether setup has been completed:

```
pk: "system#config"
sk: "setup"
completedAt: string        // ISO timestamp, presence = setup done
adminEmail: string         // who completed it
```

### Flow

#### First-Time Setup (`/setup`)

1. User visits `/setup`
2. Server checks: does `system#config / setup` record exist?
   - **Yes** → redirect to `/sign-in` (setup already completed)
   - **No** → show setup form (email input)
3. User submits email
4. Server:
   - Creates auth account via `AuthClient.invoke({ type: "newEmailAccount", ... })`
   - Creates user record with `type: "admin"` and `domains: []`
   - Creates `system#config / setup` record
   - Redirects to `/sign-in`
5. User signs in with OTP → sees all domains (admin has full access)

**Security**: The `/setup` route is gated server-side — once the setup record exists, the form is never rendered again. Even if someone POST's to it, the server rejects it.

#### Admin Invites User

1. Admin navigates to `/users` (new page)
2. Admin clicks "Invite user"
3. Form: email + select domains (multi-select from available domains)
4. Server:
   - Creates auth account via `AuthClient.invoke({ type: "newEmailAccount", ... })`
   - Creates user record with `type: "user"` and selected `domains`
5. Invited user can now sign in and sees only their whitelisted domains

#### Admin Manages Users

- `/users` page: list all users with their type and domain access
- Edit user: change domain whitelist
- Remove user: delete user record (auth account remains — could add auth deletion later)

### Route Structure

```
/setup                    — one-time admin setup (public, self-gating)
/sign-in                  — email OTP sign-in (public)
/sign-in/verify           — OTP code entry (public)
/                         — domain list (authenticated)
/domains/[domain]         — domain reports (authenticated)
/users                    — user management (admin only)
/users/invite             — invite form (admin only)
/users/[email]/edit       — edit user domains (admin only)
```

### Auth Guard Changes

The `authGuard` in `hooks.server.ts` needs to:

- Allow `/setup` as a public path (but the route itself gates on server)
- Load user type into `locals.user`
- For admin: `domains` is effectively `"*"` (all domains)
- For user: `domains` is the whitelist array

### Changes to Existing Code

1. **User schema**: Add `type: "admin" | "user"` and `createdAt` fields
2. **Users class**: Add `hasAnyUsers()` method (for setup gate check)
3. **Setup model**: New `SystemConfig` class or extend Users with system config methods
4. **Home page (`/+page.server.ts`)**: Admin sees all domains, user sees whitelisted
5. **hooks.server.ts**: Load `user.type` into locals
6. **App.Locals**: Add `type` to the user interface
7. **CDK construct**: Remove `adminEmailAddress` prop (not needed anymore)
8. **Delete `scripts/create-user.ts`**: Replaced by setup flow + invite UI

## Task Breakdown (Rough)

### Task 1: Update User schema and model

- Add `type` and `createdAt` fields
- Add `hasAnyUsers()` method (query reverse GSI for `sk = "user"`, limit 1)
- Add `listAll()` method for admin user management page
- Add `updateDomains({ email, domains })` method
- Add `delete({ email })` method

### Task 2: Implement setup gate

- Create system config entity (`pk: "system#config"`, `sk: "setup"`)
- `isSetupComplete()` method — GetCommand, returns boolean
- `markSetupComplete({ adminEmail })` method — PutCommand with condition

### Task 3: Create `/setup` route

- `+page.server.ts`: load checks `isSetupComplete()`, redirects if done
- `+page.svelte`: simple email form
- Default form action: validates, creates admin account + user + marks setup complete
- Public route (add to `publicPaths` in hooks)

### Task 4: Update auth guard for user types

- Load `user.type` into locals
- Admin: set `domains` to all available (or special marker)
- Update home page to not filter for admin

### Task 5: Create admin user management pages

- `/users` — list all users (admin only, 403 for non-admin)
- `/users/invite` — invite form with email + domain multi-select
- `/users/[email]/edit` — edit domain whitelist
- Delete user action

### Task 6: Remove CLI script

- Delete `scripts/create-user.ts`
- Remove `create-user` script from `package.json`
- Update any documentation referencing the script

### Task 7: End-to-end validation

- Build, type-check, lint, test
- Deploy and test the full flow: setup → sign-in → view domains → invite user

## Open Questions

1. **Should admin be able to promote another user to admin?** — Probably yes, but could be Phase 6.
2. **Should removing a user also revoke their auth session?** — Nice to have, could call auth SDK to invalidate sessions.
3. **Should the invite send an email notification?** — Would require email service integration. Could be Phase 6.
4. **Rate limiting on `/setup`?** — The one-time gate is sufficient, but could add a cooldown on failed attempts.
5. **Should `/setup` require an OTP verification step?** — The admin email gets verified on first sign-in anyway (OTP flow). The setup just registers the account. No need for double verification.

## Design Decisions

### Why `/setup` route instead of CDK prop

- **Zero-config deployment**: Deploy and visit — no need to know the admin email at deploy time
- **No chicken-and-egg**: The CloudFront URL doesn't need to be known before the admin email is set
- **Self-contained**: The dashboard manages its own user lifecycle entirely
- **Secure**: Server-side gate ensures the setup form only works once, ever

### Why not auto-create admin on first sign-in attempt

- A random person discovering the URL could become admin if they sign in before the real admin
- The explicit `/setup` route requires intentional action
- The gate record makes it deterministic — either setup is complete or it isn't

### Why admin sees all domains without explicit whitelist

- Admin is the operator — they deployed the infrastructure, they should see everything
- Avoids needing to update admin's whitelist every time a new domain starts receiving DMARC reports
- Simpler model: `type: "admin"` means "skip domain filtering"
