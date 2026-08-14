# @beesolve/dmarc-dashboard

## 0.0.6

### Patch Changes

- c0d250e: Build cdk.ts via bunup, pre-build authConsumer lambda, output SvelteKit to dist/build via adapter config
- @beesolve/dmarc-consumer@0.0.4

## 0.0.5

### Patch Changes

- Fix published files — include cdk.ts, src/authConsumer.ts, and build directory instead of empty dist

## 0.0.4

### Patch Changes

- Fix dependency version ranges for workspace packages (dmarc-consumer was unresolvable at ^0.0.1)

## 0.0.3

### Patch Changes

- 67f4065: Pin TypeScript to v6 for svelte-check compatibility (svelte-check does not yet support TS7 as sole version)
- @beesolve/dmarc-consumer@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [d54dca7]
- Updated dependencies [f8e3f7b]
- Updated dependencies [d54dca7]
- Updated dependencies [d674ccd]
  - @beesolve/auth-service@0.13.0
  - @beesolve/cdk-constructs@0.3.0
  - @beesolve/lambda-fetch-api@2.1.0
  - @beesolve/dmarc-consumer@0.0.2
  - @beesolve/email-service@0.3.6
