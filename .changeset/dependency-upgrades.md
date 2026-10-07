---
"@beesolve/dmarc-parser": patch
"@beesolve/lambda-keep-active": patch
"@beesolve/lint-config": patch
---

Upgrade dependencies.

- `dmarc-parser`: bump `fast-xml-parser`, `mailparser`, and `@types/mailparser`.
- `lambda-keep-active`: bump `@aws-sdk/client-lambda`, `@aws-sdk/client-resource-groups-tagging-api`, and the `aws-cdk-lib` dependency and peer range.
- `lint-config`: bump `oxlint-plugin-eslint` and raise the `oxfmt`, `oxlint`, and `oxlint-tsgolint` peer ranges to match the toolchain versions used across the monorepo.
