# dmarc-dashboard — Plan

## TODO

### Enable oxlint for dmarc-dashboard

Currently excluded from oxlint (`--ignore-pattern packages/dmarc-dashboard/`) because the tsconfig extends `.svelte-kit/tsconfig.json` which only exists after `svelte-kit sync`.

**Fix:** Add `"prepare": "svelte-kit sync"` to `package.json` scripts. Bun runs `prepare` after `bun install` in workspace packages, so `.svelte-kit/tsconfig.json` will exist by the time lint runs — both locally and in CI. Then remove the `--ignore-pattern` from the root `package.json` lint/check scripts.
