---
"@beesolve/analytics-processor": minor
---

Ship the operational commands as executable bins so consumers can run them
without cloning the monorepo. The package now exposes `analytics-backfill`,
`analytics-watch-backfill`, and `analytics-compact` (runnable via `npx`), each
built as a self-contained Node bundle with a shebang. Previously these lived
only as repo-local `bun run` scripts under `command/`, which were not published.
Adds a how-to guide documenting the required env vars and usage.
