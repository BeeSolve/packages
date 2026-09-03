---
"@beesolve/dmarc-dashboard": patch
---

Support running the dashboard locally against the real backend.

- Inject a DEV-only fake session (guarded by `import.meta.env.DEV`) built from a
  `DEV_USER_EMAIL` env var, so `bun run dev` resolves a real user without a
  sign-in flow. Compiled out of the deployed Lambda bundle.
- `dev` script now runs `bun --env-file=.env.local vite dev` so the local env is
  loaded into `process.env` before the SDK clients parse it at import.
- Add `.env.local.example` documenting the full env surface and a Local
  Development section to the README.
- Add `docs/ipinfo-setup.md` explaining how to obtain and configure an
  ipinfo.io Lite API key for source IP enrichment, locally and in a deployment.
