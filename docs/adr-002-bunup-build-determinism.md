# ADR-002: bunup workspace build determinism

## Status

Accepted

## Context

`bun run build` failed intermittently with:

```
UNKNOWN ERROR
ENOENT: no such file or directory, open '.../packages/<pkg>/dist/<file>.js'
```

The failing file changed from run to run (`dmarc-consumer/dist/report.js`,
`dmarc-dashboard/dist/cdk.js`, `dmarc-reports/dist/index.js`, ...), which is the
signature of a concurrency race rather than a genuine build error.

bunup builds workspace packages **concurrently**. With `clean` enabled (the
default), each package removes and recreates its own `dist` directory in
parallel, and bunup's post-build file reads (size reporting) race against a
sibling package's clean, transiently observing a file that is mid-delete.

This only affected the multi-package workspace build; single-package builds
(`bunup --filter <name>`) were stable. bunup was already on its latest version
(`0.16.32`), so upgrading was not an available fix.

## Decision

Disable bunup's per-package `clean` and perform a single, sequential clean up
front instead.

- `bunup.config.ts` sets `clean: false` for every workspace config (injected via
  a `.map` over the workspace array so it stays DRY).
- `scripts/cleanDist.ts` removes each `packages/*/dist` sequentially.
- The root `build` script runs the clean before bunup:

```jsonc
"build": "bun scripts/cleanDist.ts && bunup && bun scripts/buildLambdas.ts"
```

## Rationale

The race is between concurrent directory deletions and bunup's file reads.
Removing the concurrent deletion (a single sequential clean before any build
starts) eliminates the race while still guaranteeing a fresh output directory.
Sequential cleaning is cheap (directory removal only) and runs once, so it does
not meaningfully slow the build.

Disabling only the gzip size report was tried first and reduced but did not
eliminate the failures, because the underlying concurrent `clean` remained. The
`clean` step is the actual source of the race.

## Consequences

Positive:

- Deterministic builds; verified across repeated full `bun run build` runs.
- Unblocks CI (which runs `bun run build`) and the build-before-test workflow
  (see ADR-001).

Negative / trade-offs accepted:

- `bunup --watch` (the `dev` script) no longer cleans on start, since `clean` is
  disabled in config. This is acceptable for incremental development; a fresh
  build is available via `bun run build`.
- Cleaning is now a separate script rather than a bunup built-in, adding one
  small maintained file (`scripts/cleanDist.ts`).

## Alternatives Considered

### Disable the gzip size report only

Set `report: { gzip: false }`. Reduced failure frequency but did not eliminate
it — the concurrent `clean` still raced. Rejected as incomplete.

### Build each package sequentially via `--filter`

Run one `bunup --filter <name>` per package in topological order. Stable, but
slower and it discards bunup's built-in workspace handling and reporting.
Rejected in favor of keeping bunup's concurrent build with an up-front clean.

### Upgrade bunup

Already on the latest published version; no fix available upstream at the time.

## References

- ADR-001: Test built artifacts (build before test)
- https://bunup.dev/docs/guide/workspaces
