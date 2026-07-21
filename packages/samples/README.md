# @beesolve/samples

Deployable reference implementations showcasing `@beesolve/*` packages. Each sample is a standalone CDK stack with a SvelteKit frontend deployed via `kit-on-lambda`.

## Samples

### authEmailSimple

Minimal email code authentication. Users must be pre-created — no sign-up. Demonstrates `@beesolve/auth-service` with session validation in SvelteKit hooks (Function URL pattern).

### authEmailAuthorizer

Same flow as authEmailSimple but uses an HTTP API Gateway Lambda authorizer for session validation. The SvelteKit app receives authenticated context automatically — no auth logic in hooks.

### authWithEmail

Full-featured email code authentication with real email delivery via `@beesolve/email-service`. Includes sign-in, code verification with resend + countdown, and sign-out. The EventBridge consumer sends actual verification code emails.

### emailVerify

Standalone email verification form (contact form pattern). Demonstrates `@beesolve/action-tokens` directly — no auth system involved. Submitting the form sends a verification code to the user's email; entering the code sends the contact message to the recipient.

## Deployment

Each sample deploys independently:

```bash
bun run deploy:authEmailSimple
bun run deploy:authEmailAuthorizer
bun run deploy:authWithEmail
bun run deploy:emailVerify
```

Environment variables are configured in `mise.toml`.

## Structure

```
samples/
├── authEmailSimple/       # Auth with session check in hooks
├── authEmailAuthorizer/   # Auth with Lambda authorizer
├── authWithEmail/         # Auth with email delivery
├── emailVerify/           # Standalone email verification (action-tokens)
├── shared/components/     # Reusable Svelte components
├── app.ts                 # CDK app entry — registers all stacks
├── mise.toml              # Environment variables
└── package.json
```
